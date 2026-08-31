import { toast } from "@/store/toastStore";

/**
 * Hook de notificaciones éxito/error/info reutilizable en toda la app.
 *
 * Ejemplo:
 *   const toast = useToast();
 *   toast.success("Paquete actualizado correctamente");
 *   toast.error(getErrorMessage(e, "No se pudo actualizar el paquete"));
 */
export function useToast() {
  return toast;
}

export default useToast;
