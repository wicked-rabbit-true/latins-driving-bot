import { useState } from "react";
import { UseFormReturn, useWatch } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Search, Loader2, MapPin, GraduationCap, CalendarDays, CreditCard } from "lucide-react";

function calcAge(dateString: string | null | undefined): number | null {
  if (!dateString) return null;
  const birth = new Date(dateString);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age < 0 ? null : age;
}

function toJapaneseEra(dateString: string | null | undefined): string | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("ja-JP-u-ca-japanese", {
      era: "long",
      year: "numeric",
    }).format(date);
  } catch {
    return null;
  }
}

function BirthDateInfo({ control }: { control: any }) {
  const fechaNacimiento = useWatch({ control, name: "fechaNacimiento" });
  const era = toJapaneseEra(fechaNacimiento);
  const age = calcAge(fechaNacimiento);
  if (!era && age === null) return null;
  return (
    <div className="flex items-center gap-2 mt-1 flex-wrap">
      {era && (
        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded font-medium">
          {era}生
        </span>
      )}
      {age !== null && (
        <span className="text-xs font-bold text-primary">
          {age}歳
        </span>
      )}
    </div>
  );
}

interface StudentFormProps {
  form: UseFormReturn<any>;
  onSubmit: (data: any) => void;
  isPending: boolean;
  isEditing?: boolean;
}

async function lookupPostalCode(rawCode: string): Promise<{ address1: string; address2: string; address3: string } | null> {
  const zipcode = rawCode.replace(/[^0-9]/g, "");
  if (zipcode.length !== 7) return null;
  const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zipcode}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 200 || !data.results || data.results.length === 0) return null;
  return data.results[0];
}

export function StudentForm({ form, onSubmit, isPending, isEditing = false }: StudentFormProps) {
  const [postalLoading, setPostalLoading] = useState(false);
  const [postalError, setPostalError] = useState<string | null>(null);

  async function handlePostalLookup() {
    const code = form.getValues("codigoPostal");
    if (!code) return;
    setPostalLoading(true);
    setPostalError(null);
    try {
      const result = await lookupPostalCode(code);
      if (!result) {
        setPostalError("Código postal no encontrado");
      } else {
        const baseAddress = `${result.address1} ${result.address2} ${result.address3}`;
        const current = form.getValues("direccion") || "";
        if (!current) {
          form.setValue("direccion", baseAddress, { shouldDirty: true });
        } else {
          form.setValue("direccion", baseAddress + " " + current.replace(/^[\u3000-\u9fff\u30a0-\u30ff\uff00-\uffef\u4e00-\u9fff\s]+/, "").trim(), { shouldDirty: true });
        }
      }
    } catch {
      setPostalError("Error al consultar el código postal");
    } finally {
      setPostalLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" id="student-form">
        <Card>
          <CardHeader>
            <CardTitle>Información Personal</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Nombre completo *</FormLabel>
                  <FormControl>
                    <Input placeholder="Carlos Rodriguez" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="telefono"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teléfono *</FormLabel>
                  <FormControl>
                    <Input placeholder="090-1234-5678" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input placeholder="carlos@example.com" type="email" {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="fechaNacimiento"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de nacimiento</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value || ""} />
                  </FormControl>
                  <BirthDateInfo control={form.control} />
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="sexo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Género</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar género" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="M">Masculino (M)</SelectItem>
                      <SelectItem value="F">Femenino (F)</SelectItem>
                      <SelectItem value="Otro">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="preferredLanguage"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Idioma preferido</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar idioma" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="es">Español (es)</SelectItem>
                      <SelectItem value="en">English (en)</SelectItem>
                      <SelectItem value="pt">Português (pt)</SelectItem>
                      <SelectItem value="ur">اردو (ur)</SelectItem>
                      <SelectItem value="ne">नेपाली (ne)</SelectItem>
                      <SelectItem value="tr">Türkçe (tr)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Postal Code with Japan lookup */}
            <FormField
              control={form.control}
              name="codigoPostal"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    Código postal japonés (〒)
                  </FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        placeholder="例: 100-0001"
                        {...field}
                        value={field.value || ""}
                        onChange={(e) => {
                          field.onChange(e);
                          setPostalError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handlePostalLookup();
                          }
                        }}
                        maxLength={8}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handlePostalLookup}
                      disabled={postalLoading}
                      title="Buscar dirección por código postal"
                    >
                      {postalLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  {postalError && (
                    <p className="text-sm text-destructive mt-1">{postalError}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Ingresa el código postal y presiona <kbd className="px-1 py-0.5 rounded border text-xs">Enter</kbd> o el botón para autocompletar la dirección.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="direccion"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Dirección completa</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Se autocompleta con el código postal — agrega número de edificio/piso"
                      {...field}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    El código postal rellena prefectura + ciudad + barrio. Agrega el número de edificio o piso al final.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Curso y Operaciones</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="tipoLicencia"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de licencia</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar licencia" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="AT">Automático (AT)</SelectItem>
                      <SelectItem value="MT">Manual (MT)</SelectItem>
                      <SelectItem value="3 Toneladas">3 Toneladas</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="prefectura"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Departamento de tránsito / 都道府県</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar departamento" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="tochigi">Tochigi（栃木県）</SelectItem>
                      <SelectItem value="saitama">Saitama（埼玉県）</SelectItem>
                      <SelectItem value="kanagawa">Kanagawa（神奈川県）</SelectItem>
                      <SelectItem value="tokyo">Tokyo（東京都）</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Departamento de tránsito al que pertenece el alumno. Determina la dirección en el certificado.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expiracionVisa"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vencimiento de visa</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="fechaInscripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" />
                    Fecha de inscripción / 入校日 *
                  </FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value || ""} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Fecha en que el alumno ingresó a la escuela. Se usa en el certificado de matrícula.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="md:col-span-2">
              <Separator className="my-2" />
            </div>

            <FormField
              control={form.control}
              name="valorCurso"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor total del curso (¥)</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="150000" {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="montoPagado"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monto pagado (¥)</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="50000" {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notas"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel>Notas internas</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Agrega notas internas aquí..." 
                      className="min-h-[120px] resize-y" 
                      {...field} 
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              Estado del Proceso
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="examen50Estado"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1">
                    <GraduationCap className="w-3 h-3" />
                    Examen de 50 preguntas
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || "pendiente"}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Estado del examen" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="pendiente">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                          Pendiente
                        </span>
                      </SelectItem>
                      <SelectItem value="aprobado">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
                          Aprobado ✓
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Al marcar como aprobado se revocará automáticamente el acceso a iGiveTest.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="examen100Estado"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1">
                    <GraduationCap className="w-3 h-3" />
                    Examen de 100 preguntas
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || "pendiente"}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Estado del examen" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="pendiente">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                          Pendiente
                        </span>
                      </SelectItem>
                      <SelectItem value="aprobado">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
                          Aprobado ✓
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="examen100Departamento"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    Centro del examen 100 preguntas
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar departamento" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="tochigi">Tochigi（栃木）</SelectItem>
                      <SelectItem value="saitama">Saitama（埼玉）</SelectItem>
                      <SelectItem value="chiba">Chiba（千葉）</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Departamento de tránsito donde rinde el examen.</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="md:col-span-2">
              <Separator className="my-1" />
              <p className="text-sm font-medium flex items-center gap-2 mt-3 mb-4 text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                Curso Internado (合宿)
              </p>
            </div>

            <FormField
              control={form.control}
              name="internadoFechaInicio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de inicio del internado</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value || ""} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">Dejar vacío si aún no está confirmada.</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="internadoFechaFin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha de finalización del internado</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="md:col-span-2">
              <Separator className="my-1" />
            </div>

            <FormField
              control={form.control}
              name="pagoEstado"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-1">
                    <CreditCard className="w-3 h-3" />
                    Estado del pago
                  </FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || "pendiente"}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Estado del pago" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="pendiente">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-red-400 inline-block" />
                          Pendiente
                        </span>
                      </SelectItem>
                      <SelectItem value="pagado">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
                          Pagado ✓
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}
