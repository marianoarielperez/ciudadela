// Marco de Solicitudes del socio (M7): el <h1> y las dos sub-pestañas. NO
// autoriza: cada página llama a `requireMember` por su cuenta (el layout corre
// en paralelo y no protege a lo que envuelve — la misma advertencia que el
// layout de /mi).
import { MiSolicitudesTabs } from "@/components/mi/solicitudes-tabs";
import { MI_SOLICITUDES_TABS } from "@/lib/mi/solicitudes-tabs";

export default function MiSolicitudesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Solicitudes</h1>
        <p className="text-sm text-muted-foreground">
          Trámites ante la Comisión —baja o cambio de categoría— y reportes del barrio: reclamos e
          iniciativas.
        </p>
      </div>
      <MiSolicitudesTabs tabs={MI_SOLICITUDES_TABS} />
      {children}
    </div>
  );
}
