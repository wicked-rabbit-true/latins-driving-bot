import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ChevronLeft, Save } from "lucide-react";
import { useCreateStudent, getListProspectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { StudentForm } from "@/components/StudentForm";

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
});

type StudentFormValues = z.infer<typeof studentSchema>;

export default function NewStudentPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createStudent = useCreateStudent();
  const queryClient = useQueryClient();

  const prefilledPhone = new URLSearchParams(window.location.search).get("phone") ?? "";
  const fromProspects = Boolean(prefilledPhone);

  const form = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      nombre: "",
      telefono: prefilledPhone,
      email: "",
      sexo: undefined,
      fechaNacimiento: "",
      direccion: "",
      codigoPostal: "",
      tipoLicencia: undefined,
      prefectura: undefined,
      expiracionVisa: "",
      fechaInscripcion: "",
      valorCurso: undefined,
      montoPagado: undefined,
      notas: "",
    },
  });

  const onSubmit = async (data: StudentFormValues) => {
    try {
      const result = await createStudent.mutateAsync({
        data: {
          ...data,
          // Convert empty strings to undefined for API
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
        }
      });
      
      toast({
        title: "Student created",
        description: `${result.nombre} has been added successfully.`,
      });

      if (fromProspects) {
        await queryClient.invalidateQueries({ queryKey: getListProspectsQueryKey() });
      }
      
      setLocation(`/students/${result.id}`);
    } catch (error) {
      toast({
        title: "Error creating student",
        description: "Please check the phone number is unique and try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <header className="p-4 md:p-6 border-b border-border bg-card shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="rounded-full">
            <Link href={fromProspects ? "/prospects" : "/students"}>
              <ChevronLeft className="h-5 w-5" />
              <span className="sr-only">Back</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">Nuevo alumno</h1>
            <p className="text-sm text-muted-foreground hidden md:block">
              {fromProspects
                ? "Convirtiendo prospecto — teléfono pre-cargado"
                : "Agregar un nuevo alumno a Latin's Driving Support"}
            </p>
          </div>
        </div>
        
        <Button onClick={form.handleSubmit(onSubmit)} disabled={createStudent.isPending}>
          {createStudent.isPending ? (
            <span className="flex items-center gap-2">Saving...</span>
          ) : (
            <span className="flex items-center gap-2"><Save className="h-4 w-4" /> Save Student</span>
          )}
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="max-w-3xl mx-auto">
          <StudentForm form={form} onSubmit={onSubmit} isPending={createStudent.isPending} />
        </div>
      </div>
    </div>
  );
}
