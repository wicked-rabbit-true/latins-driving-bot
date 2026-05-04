import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ChevronLeft, Save } from "lucide-react";
import { useGetStudent, getGetStudentQueryKey, useUpdateStudent, type Student } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StudentForm } from "@/components/StudentForm";
import { LanguageBadge } from "@/components/LanguageBadge";
import { useQueryClient } from "@tanstack/react-query";

const studentSchema = z.object({
  nombre: z.string().min(1, "Name is required"),
  telefono: z.string().min(1, "Phone is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  sexo: z.enum(["M", "F", "Otro"]).optional().or(z.literal("")),
  fechaNacimiento: z.string().optional().or(z.literal("")),
  direccion: z.string().optional().or(z.literal("")),
  codigoPostal: z.string().optional().or(z.literal("")),
  tipoLicencia: z.enum(["AT", "MT", "3 Toneladas"]).optional().or(z.literal("")),
  prefectura: z.enum(["tochigi", "saitama", "kanagawa", "tokyo"]).optional().or(z.literal("")),
  expiracionVisa: z.string().optional().or(z.literal("")),
  fechaInscripcion: z.string().optional().or(z.literal("")),
  valorCurso: z.coerce.number().optional(),
  montoPagado: z.coerce.number().optional(),
  notas: z.string().optional().or(z.literal("")),
  examen50Estado: z.enum(["pendiente", "aprobado"]).optional(),
  internadoFechaInicio: z.string().optional().or(z.literal("")),
  internadoFechaFin: z.string().optional().or(z.literal("")),
  examen100Estado: z.enum(["pendiente", "aprobado"]).optional(),
  examen100Departamento: z.enum(["tochigi", "saitama", "chiba"]).optional().or(z.literal("")),
  pagoEstado: z.enum(["pendiente", "pagado"]).optional(),
  preferredLanguage: z.enum(["es", "en", "pt", "ur", "ne", "tr"]).optional().or(z.literal("")),
});

type StudentFormValues = z.infer<typeof studentSchema>;

function buildDefaultValues(student: Student): StudentFormValues {
  return {
    nombre: student.nombre,
    telefono: student.telefono,
    email: student.email || "",
    sexo: (student.sexo as StudentFormValues["sexo"]) || undefined,
    fechaNacimiento: student.fechaNacimiento || "",
    direccion: student.direccion || "",
    codigoPostal: student.codigoPostal || "",
    tipoLicencia: (student.tipoLicencia as StudentFormValues["tipoLicencia"]) || undefined,
    prefectura: (student.prefectura as StudentFormValues["prefectura"]) || undefined,
    expiracionVisa: student.expiracionVisa || "",
    fechaInscripcion: student.fechaInscripcion || "",
    valorCurso: student.valorCurso ?? undefined,
    montoPagado: student.montoPagado ?? undefined,
    notas: student.notas || "",
    examen50Estado: (student.examen50Estado as StudentFormValues["examen50Estado"]) || "pendiente",
    internadoFechaInicio: student.internadoFechaInicio || "",
    internadoFechaFin: student.internadoFechaFin || "",
    examen100Estado: (student.examen100Estado as StudentFormValues["examen100Estado"]) || "pendiente",
    examen100Departamento: (student.examen100Departamento as StudentFormValues["examen100Departamento"]) || undefined,
    pagoEstado: (student.pagoEstado as StudentFormValues["pagoEstado"]) || "pendiente",
    preferredLanguage: (student.preferredLanguage as StudentFormValues["preferredLanguage"]) || undefined,
  };
}

function EditStudentForm({ student, id }: { student: Student; id: number }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateStudent = useUpdateStudent();

  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: buildDefaultValues(student),
  });

  const watchedLanguage = form.watch("preferredLanguage");

  const onSubmit = async (data: StudentFormValues) => {
    try {
      const result = await updateStudent.mutateAsync({
        id,
        data: {
          ...data,
          email: data.email || undefined,
          sexo: data.sexo || undefined,
          fechaNacimiento: data.fechaNacimiento || undefined,
          direccion: data.direccion || undefined,
          codigoPostal: data.codigoPostal || undefined,
          tipoLicencia: data.tipoLicencia || undefined,
          prefectura: data.prefectura || undefined,
          expiracionVisa: data.expiracionVisa || undefined,
          fechaInscripcion: data.fechaInscripcion || undefined,
          notas: data.notas || undefined,
          internadoFechaInicio: data.internadoFechaInicio || undefined,
          internadoFechaFin: data.internadoFechaFin || undefined,
          examen100Departamento: data.examen100Departamento || undefined,
          preferredLanguage: data.preferredLanguage || undefined,
        }
      });

      queryClient.setQueryData(getGetStudentQueryKey(id), result);
      await queryClient.invalidateQueries({ queryKey: getGetStudentQueryKey(id) });

      toast({
        title: "Guardado correctamente",
        description: `El perfil de ${result.nombre} ha sido actualizado.`,
      });

      setLocation(`/students/${id}`);
    } catch (error) {
      toast({
        title: "Error al guardar",
        description: "No se pudo actualizar el perfil del estudiante.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <header className="p-4 md:p-6 border-b border-border bg-card shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="rounded-full">
            <Link href={`/students/${id}`}>
              <ChevronLeft className="h-5 w-5" />
              <span className="sr-only">Back</span>
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">Edit {student.nombre}</h1>
              <LanguageBadge language={watchedLanguage || null} />
            </div>
          </div>
        </div>

        <Button onClick={form.handleSubmit(onSubmit)} disabled={updateStudent.isPending}>
          {updateStudent.isPending ? (
            <span className="flex items-center gap-2">Guardando...</span>
          ) : (
            <span className="flex items-center gap-2"><Save className="h-4 w-4" /> Guardar cambios</span>
          )}
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="max-w-3xl mx-auto">
          <StudentForm form={form} onSubmit={onSubmit} isPending={updateStudent.isPending} isEditing />
        </div>
      </div>
    </div>
  );
}

export default function EditStudentPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);

  const { data: student, isLoading } = useGetStudent(id, {
    query: { enabled: !!id, queryKey: getGetStudentQueryKey(id) }
  });

  if (isLoading || !student) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6 w-full">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return <EditStudentForm student={student} id={id} key={student.id} />;
}
