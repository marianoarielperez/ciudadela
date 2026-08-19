import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/members/labels";
import { formatDateAR } from "@/lib/format";
import { CargaForm } from "./carga-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Modo carga — SIGeV" };

export default async function CargaPage(props: { params: Promise<{ numero: string }> }) {
  // El número llega de la URL: con "abc" o "1e9" Number() da NaN o un no entero
  // y Prisma tiraría un error técnico en inglés en vez de un 404.
  const numero = Number((await props.params).numero);
  if (!Number.isInteger(numero) || numero <= 0) notFound();

  const book = await prisma.book.findFirst({ where: { status: "open" } });
  if (!book) notFound();

  const membership = await prisma.membership.findUnique({
    where: { bookId_memberNumber: { bookId: book.id, memberNumber: numero } },
    include: { member: true },
  });
  if (!membership) notFound();
  const m = membership.member;

  // Anterior y siguiente por consulta y no por numero±1: el Libro N° 1 tiene
  // huecos (números anulados, fichas que nunca se asentaron) y avanzar de a uno
  // llevaría al operador a un 404 en medio de la carga.
  const [prev, next, streets] = await Promise.all([
    prisma.membership.findFirst({
      where: { bookId: book.id, memberNumber: { lt: numero } },
      orderBy: { memberNumber: "desc" }, select: { memberNumber: true },
    }),
    prisma.membership.findFirst({
      where: { bookId: book.id, memberNumber: { gt: numero } },
      orderBy: { memberNumber: "asc" }, select: { memberNumber: true },
    }),
    prisma.street.findMany({
      orderBy: { loadOrder: "asc" }, select: { id: true, name: true, loadOrder: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/admin/socios" className="hover:underline">Socios</Link> / Modo carga
        </p>
        <h1 className="text-2xl font-semibold">N° {numero} — {m.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {CATEGORY_LABELS[m.category]} · {STATUS_LABELS[m.status]} · Ingreso {formatDateAR(m.joinedAt)} ·{" "}
          <Link className="text-primary hover:underline" href={`/admin/socios/${m.id}`}>ver ficha</Link>
        </p>
      </div>

      <CargaForm
        key={m.id}
        member={{
          id: m.id, fullName: m.fullName, dni: m.dni,
          // El nacimiento se guarda como fecha civil a mediodía UTC: recortar el
          // ISO da el día correcto sin que la zona lo corra.
          birthDate: m.birthDate ? m.birthDate.toISOString().slice(0, 10) : null,
          civilStatus: m.civilStatus, nationality: m.nationality, occupation: m.occupation,
          phone: m.phone, streetId: m.streetId, streetText: m.streetText,
          streetNumber: m.streetNumber, neighborhood: m.neighborhood,
          email: m.email, emailStatus: m.emailStatus,
        }}
        streets={streets}
        prevNumber={prev?.memberNumber ?? null}
        nextNumber={next?.memberNumber ?? null}
      />
    </div>
  );
}
