// Statutory actions: every one runs in a transaction, requires a Minute and
// writes a Movement. Audit rows are written by the calling server action
// (it knows actor IP); this service records actor ids on movements.
import type { Book, MemberCategory, PrismaClient, WithdrawalReason } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canChangeCategory, canReadmit, canSuspend, canWithdraw } from "./rules";

// El cliente que `$transaction` le pasa al callback: mismo API menos los
// métodos de control de sesión (`$transaction`, `$connect`, …).
type Tx = Pick<PrismaClient, "book" | "member" | "membership" | "minute" | "movement">;

// Exportada: las server actions la consultan para poder rechazar el cambio de
// categoría ANTES de crear el acta (ver el comentario sobre el acta huérfana en
// src/app/admin/socios/[id]/actions.ts) y para no ofrecer el formulario cuando ya
// se sabe que el cambio está bloqueado.
export async function electionsOngoing(db: Pick<PrismaClient, "configuration">): Promise<boolean> {
  const row = await db.configuration.findUnique({ where: { key: "elecciones_en_curso" } });
  return row?.value === true;
}

// El schema NO garantiza que haya exactamente un libro abierto (no hay índice
// parcial en MySQL). Con cero libros abiertos no se puede numerar un alta; con
// dos, tomar el primero elegiría en silencio en qué libro asienta el socio.
// Las dos situaciones son un error de datos que un admin tiene que resolver.
// Exportada por el mismo motivo que `electionsOngoing`: el alta manual la corre
// antes de crear el acta de admisión, reusando estos mensajes en vez de
// duplicarlos en la capa de formulario.
export async function requireOpenBook(tx: Pick<Tx, "book">): Promise<Book> {
  const open = await tx.book.findMany({ where: { status: "open" }, orderBy: { number: "asc" }, take: 2 });
  if (open.length === 0) {
    throw new Error("No hay ningún libro abierto: no se puede registrar el alta hasta abrir uno.");
  }
  if (open.length > 1) {
    const numbers = open.map((b) => `N° ${b.number}`).join(" y ");
    throw new Error(`Hay más de un libro abierto (${numbers}): cerrá el que corresponda antes de registrar altas.`);
  }
  return open[0];
}

export function makeMemberService(db: PrismaClient) {
  return {
    async admit(input: {
      fullName: string; category: MemberCategory; minuteId: number; actorId: number;
      dni?: string; email?: string; birthDate?: Date; civilStatus?: string; nationality?: string;
      occupation?: string; phone?: string; streetId?: number; streetText?: string;
      streetNumber?: string; neighborhood?: string;
    }) {
      return db.$transaction(async (tx) => {
        const book = await requireOpenBook(tx);
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const max = await tx.membership.aggregate({ where: { bookId: book.id }, _max: { memberNumber: true } });
        const member = await tx.member.create({
          data: {
            fullName: input.fullName, category: input.category, status: "active",
            dni: input.dni ?? null, email: input.email ?? null,
            emailStatus: input.email ? "declared" : "none",
            birthDate: input.birthDate ?? null, civilStatus: input.civilStatus ?? null,
            nationality: input.nationality ?? null, occupation: input.occupation ?? null,
            phone: input.phone ?? null, streetId: input.streetId ?? null,
            streetText: input.streetText ?? null, streetNumber: input.streetNumber ?? null,
            neighborhood: input.neighborhood ?? null,
            joinedAt: minute.date, // REG-11: fecha de ingreso = fecha del acta
          },
        });
        await tx.membership.create({
          data: { memberId: member.id, bookId: book.id, memberNumber: (max._max.memberNumber ?? 0) + 1 },
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "admission", date: minute.date, minuteId: minute.id,
            newCategory: input.category, createdById: input.actorId,
          },
        });
        return member;
      });
    },

    async withdraw(input: { memberId: number; reason: WithdrawalReason; minuteId: number; actorId: number; detail?: string }) {
      return db.$transaction(async (tx) => {
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        const check = canWithdraw(member);
        if (!check.ok) throw new Error(check.error);
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const updated = await tx.member.update({
          where: { id: member.id },
          data: {
            status: "withdrawn", withdrawalReason: input.reason, leftAt: minute.date,
            reentryBlocked: input.reason === "expulsion" ? true : member.reentryBlocked,
            suspendedFrom: null, suspendedTo: null,
          },
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "withdrawal", date: minute.date, minuteId: minute.id,
            reason: input.reason, detail: input.detail ?? null, createdById: input.actorId,
          },
        });
        return updated;
      });
    },

    async changeCategory(input: { memberId: number; newCategory: MemberCategory; minuteId: number; actorId: number }) {
      const ongoing = await electionsOngoing(db);
      return db.$transaction(async (tx) => {
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        const check = canChangeCategory(member, input.newCategory, ongoing);
        if (!check.ok) throw new Error(check.error);
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const updated = await tx.member.update({
          where: { id: member.id },
          data: { category: input.newCategory }, // joinedAt NO se toca (REG-07: no interrumpe antigüedad)
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "category_change", date: minute.date, minuteId: minute.id,
            previousCategory: member.category, newCategory: input.newCategory, createdById: input.actorId,
          },
        });
        return updated;
      });
    },

    async suspend(input: { memberId: number; from: Date; to: Date; minuteId: number; actorId: number; detail?: string }) {
      return db.$transaction(async (tx) => {
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        const check = canSuspend(member);
        if (!check.ok) throw new Error(check.error);
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const updated = await tx.member.update({
          where: { id: member.id },
          data: { status: "suspended", suspendedFrom: input.from, suspendedTo: input.to },
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "suspension", date: minute.date, minuteId: minute.id,
            detail: input.detail ?? null, createdById: input.actorId,
          },
        });
        return updated;
      });
    },

    async endSuspension(input: { memberId: number; minuteId: number; actorId: number }) {
      return db.$transaction(async (tx) => {
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        if (member.status !== "suspended") throw new Error("El socio no está suspendido.");
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const updated = await tx.member.update({
          where: { id: member.id },
          data: { status: "active", suspendedFrom: null, suspendedTo: null },
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "suspension_end", date: minute.date, minuteId: minute.id,
            createdById: input.actorId,
          },
        });
        return updated;
      });
    },

    async readmit(input: { memberId: number; category: MemberCategory; minuteId: number; actorId: number }) {
      return db.$transaction(async (tx) => {
        const member = await tx.member.findUniqueOrThrow({ where: { id: input.memberId } });
        const check = canReadmit(member);
        if (!check.ok) throw new Error(check.error);
        const minute = await tx.minute.findUniqueOrThrow({ where: { id: input.minuteId } });
        const updated = await tx.member.update({
          where: { id: member.id },
          data: {
            status: "active", category: input.category, withdrawalReason: null, leftAt: null,
            // joinedAt NO se toca: el reingreso no reinicia la antigüedad (REG-11).
            // debtAtWithdrawal se conserva: M4 lo usa para calcular la deuda a saldar (REG-16)
          },
        });
        await tx.movement.create({
          data: {
            memberId: member.id, type: "readmission", date: minute.date, minuteId: minute.id,
            newCategory: input.category, createdById: input.actorId,
          },
        });
        return updated;
      });
    },
  };
}

export const memberService = makeMemberService(prisma);
