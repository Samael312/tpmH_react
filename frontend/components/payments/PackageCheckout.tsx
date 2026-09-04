// frontend/components/payments/PackageCheckout.tsx

"use client";

import { useState } from "react";
import { Check, X, Loader2, CreditCard, Split } from "lucide-react";
import api from "@/lib/api";
import PaymentMethodsInfo from "./PaymentMethodsInfo";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/errorMessage";

export interface PackageLite {
  id: number;
  name: string;
  price: number;
  classes_count: number | null;
  allow_installments: boolean;
  installment_count: number | null;
  installment_amount: number | null;
  icon?: string | null;
}

export interface PackageCheckoutProps {
  pkg: PackageLite;
  mode: "initial" | "renewal" | "change";
  enrollmentId: number | null;
  installmentsPaid: number;
  currentCredits?: number;
  // Solo relevantes en mode="change": precio y tamaño total del paquete
  // ACTUAL, necesarios para calcular el ajuste por valor en un downgrade
  // (reglas de negocio 3.1) en vez de solo contar créditos.
  currentPackagePrice?: number;
  currentPackageClassesTotal?: number;
  // Solo relevante en mode="change" cuando es un downgrade sin créditos
  // usados (Caso A de 3.1): qué eligió el estudiante.
  changeOption?: "full_refund" | "adjust_difference";
  onClose: () => void;
  onDone: () => void;
}

export default function PackageCheckout({
  pkg,
  mode,
  enrollmentId,
  installmentsPaid,
  currentCredits,
  currentPackagePrice,
  currentPackageClassesTotal,
  changeOption,
  onClose,
  onDone,
}: PackageCheckoutProps) {
  const isUnlimited = pkg.classes_count == null;
  const isChange = mode === "change";
  // BUG-18 fix: cuando se cambia HACIA un paquete ilimitado, el backend
  // aplica un cambio instantáneo y gratuito (_apply_instant_switch_to_unlimited,
  // transfiere 1:1 los créditos finitos restantes) — no corresponde pedir
  // "cuántos créditos comprar" ni mostrar un monto a pagar en ese caso.
  const isInstantSwitchToUnlimited = isUnlimited && isChange;
  const [creditsRequested, setCreditsRequested] = useState(5);
  const [useInstallments, setUseInstallments] = useState(installmentsPaid > 0);
  const [reference, setReference] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  const alreadyMidInstallments = installmentsPaid > 0;
  const nextIndex = installmentsPaid + 1;

  const installmentAmountCalculated =
    pkg.installment_amount ??
    Math.round((pkg.price / (pkg.installment_count || 1)) * 100) / 100;

  // ─── Cambio de paquete ───
  // Regla de negocio 3.1: si el paquete nuevo tiene MENOS clases que el
  // actual (downgrade), el ajuste se calcula sobre el VALOR restante del
  // paquete actual, no solo contando créditos — y si no se usó ningún
  // crédito, el estudiante elige reembolso completo o ajuste por
  // diferencia (changeOption). Para upgrades/laterales se mantiene el
  // cálculo anterior (solo se cobran los créditos faltantes). Este es un
  // cálculo aproximado para mostrar en pantalla — el backend siempre
  // recalcula de forma autoritativa al procesar la solicitud.
  const isDowngrade =
    isChange && !isUnlimited && pkg.classes_count != null &&
    currentPackageClassesTotal != null && pkg.classes_count < currentPackageClassesTotal;

  const occupiedSlots =
    currentPackageClassesTotal != null
      ? Math.max(currentPackageClassesTotal - (currentCredits ?? currentPackageClassesTotal), 0)
      : 0;

  const pricePerClass =
    !isUnlimited && pkg.classes_count ? pkg.price / pkg.classes_count : 0;

  let changeDeficit: number | null = null;   // solo aplica al camino "por créditos" (upgrade)
  let changeAmount: number | null = null;
  let isRefund = false;
  let refundIsFull = false;

  if (isChange && !isUnlimited && pkg.classes_count != null) {
    if (!isDowngrade) {
      changeDeficit = Math.max(pkg.classes_count - (currentCredits ?? 0), 0);
      changeAmount = Math.round(changeDeficit * pricePerClass * 100) / 100;
    } else if (occupiedSlots === 0 && currentPackagePrice != null) {
      // Caso A
      if (changeOption === "full_refund") {
        refundIsFull = true;
        isRefund = true;
        changeAmount = Math.round(currentPackagePrice * 100) / 100;
      } else {
        const diff = Math.round((pkg.price - currentPackagePrice) * 100) / 100;
        isRefund = diff < 0;
        changeAmount = Math.abs(diff);
      }
    } else if (currentPackagePrice != null && currentPackageClassesTotal) {
      // Caso B
      const pricePerClassOld = currentPackagePrice / currentPackageClassesTotal;
      const remainingValue = Math.round(pricePerClassOld * (currentCredits ?? 0) * 100) / 100;
      const diff = Math.round((pkg.price - remainingValue) * 100) / 100;
      isRefund = diff < 0;
      changeAmount = Math.abs(diff);
    }
  }

  const amount = isInstantSwitchToUnlimited
    ? 0
    : isUnlimited
      ? Math.round(creditsRequested * pkg.price * 100) / 100
      : isChange && changeAmount !== null
        ? changeAmount
        : (useInstallments || alreadyMidInstallments)
          ? installmentAmountCalculated
          : pkg.price;

  const noAdditionalCost = (isChange && !isDowngrade && changeDeficit === 0) || isInstantSwitchToUnlimited;

  const notify = async () => {
    setSending(true);
    setError("");
    try {
      const typeMap = { initial: "package", renewal: "renewal", change: "package_change" } as const;
      await api.post("/payments/notify-payment", {
        type: typeMap[mode],
        enrollment_id: enrollmentId ?? undefined,
        package_id: pkg.id,
        installment_index: !isChange && !isUnlimited && (useInstallments || alreadyMidInstallments) ? nextIndex : null,
        // BUG-18 fix: para paquetes ilimitados (compra inicial o renovación,
        // nunca "change" — ese caso es el switch instantáneo y gratuito de
        // arriba) hay que decirle al backend cuántos créditos se están
        // comprando; antes este campo nunca se enviaba y el estudiante
        // terminaba con 0 créditos sin importar cuánto pagara.
        credits_requested: isUnlimited && !isChange ? creditsRequested : undefined,
        change_option: isChange && isDowngrade && occupiedSlots === 0 ? (changeOption ?? "adjust_difference") : undefined,
        transaction_reference: reference.trim() || undefined,
      });
      setDone(true);
      toast.success("Solicitud de pago enviada correctamente");
      setTimeout(() => {
        onDone();
        onClose();
      }, 1500);
    } catch (e) {
      setError(getErrorMessage(e, "Error notificando el pago"));
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center py-12 gap-3 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center shadow-inner">
          <Check className="w-8 h-8 text-emerald-600" />
        </div>
        <p className="font-black text-slate-800 text-xl">¡Pago notificado!</p>
        <p className="text-xs text-slate-500 text-center max-w-sm leading-relaxed">
          Tu profesor(a) o el equipo administrativo validará la transacción en breve.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
      {/* Columna Izquierda: Información, selectores y totales */}
      <div className="space-y-5 flex flex-col justify-between">
        <div className="space-y-4">
          <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100 flex items-center justify-between">
            
            {mode !== "initial" && currentCredits !== undefined && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2.5 text-xs font-bold text-indigo-700 flex items-center justify-between">
              <span>Créditos actuales disponibles</span>
              <span className="text-sm font-black">{currentCredits}</span>
            </div>
          )}
            
            <div className="flex items-center gap-3">
              <span className="text-2xl">{pkg.icon || "📦"}</span>
              <div>
                <p className="text-sm font-black text-slate-800">{pkg.name}</p>
                <p className="text-xs text-slate-500 font-medium">
                  {isUnlimited ? "Clases ilimitadas" : `${pkg.classes_count} clases incluidas`}
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">{isUnlimited ? "Precio/clase" : "Total"}</span>
              <span className="text-base font-black text-slate-700">${pkg.price.toFixed(2)}</span>
            </div>
          </div>

          {isChange && !isDowngrade && changeDeficit !== null && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs font-bold text-blue-700 space-y-1">
              {noAdditionalCost ? (
                <p>Tus créditos actuales ya cubren este paquete — no hay costo adicional.</p>
              ) : (
                <p>
                  Solo pagas la diferencia:{" "}
                  <span className="font-black">{changeDeficit}</span> clase
                  {changeDeficit !== 1 ? "s" : ""} faltante{changeDeficit !== 1 ? "s" : ""} para
                  completar el paquete <span className="font-black">{pkg.name}</span>.
                </p>
              )}
            </div>
          )}

          {isChange && isDowngrade && refundIsFull && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-xs font-bold text-emerald-700">
              <p>
                Se te reembolsará el 100% de lo que pagaste por tu paquete actual. Tu paquete
                quedará cancelado — podrás comprar <span className="font-black">{pkg.name}</span> por
                separado cuando quieras.
              </p>
            </div>
          )}

          {isChange && isDowngrade && !refundIsFull && changeAmount !== null && (
            <div className={`rounded-xl px-4 py-3 text-xs font-bold space-y-1 ${isRefund ? "bg-emerald-50 border border-emerald-100 text-emerald-700" : "bg-blue-50 border border-blue-100 text-blue-700"}`}>
              {changeAmount === 0 ? (
                <p>El valor de tu paquete actual coincide con el nuevo — no hay costo ni reembolso.</p>
              ) : isRefund ? (
                <p>
                  Este paquete vale menos que el saldo restante de tu paquete actual — se te
                  reembolsará la diferencia a tu favor.
                </p>
              ) : (
                <p>
                  Este paquete cuesta más que el saldo restante de tu paquete actual — pagas
                  solo la diferencia.
                </p>
              )}
            </div>
          )}

          {isInstantSwitchToUnlimited && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs font-bold text-blue-700">
              <p>
                Cambio instantáneo y sin costo: tus créditos actuales se transferirán a este
                paquete ilimitado. Podrás comprar más créditos cuando quieras.
              </p>
            </div>
          )}

          {isUnlimited && !isChange ? (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                ¿Cuántas clases quieres comprar?
              </p>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setCreditsRequested(p => Math.max(1, p - 1))}
                  className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-slate-600 transition-colors">−</button>
                <input
                  type="number" min={1} value={creditsRequested}
                  onChange={e => setCreditsRequested(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24 text-center bg-slate-50 border-2 border-transparent rounded-xl text-lg font-black text-slate-800 py-2 focus:outline-none focus:border-pink-500"
                />
                <button type="button" onClick={() => setCreditsRequested(p => p + 1)}
                  className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-slate-600 transition-colors">+</button>
                <span className="text-xs font-bold text-slate-400">clases</span>
              </div>
            </div>
          ) : !isUnlimited && pkg.allow_installments && !alreadyMidInstallments && !isChange && (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                Modalidad de pago
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setUseInstallments(false)}
                  className={`flex flex-col items-center gap-1 py-3 px-3 rounded-xl border-2 text-xs font-bold transition-all ${
                    !useInstallments ? "border-pink-500 bg-pink-50 text-pink-600 shadow-sm" : "border-slate-100 bg-white text-slate-500 hover:bg-slate-50"
                  }`}>
                  <CreditCard className="w-4 h-4" /> Único (${pkg.price.toFixed(2)})
                </button>
                <button type="button" onClick={() => setUseInstallments(true)}
                  className={`flex flex-col items-center gap-1 py-3 px-3 rounded-xl border-2 text-xs font-bold transition-all ${
                    useInstallments ? "border-pink-500 bg-pink-50 text-pink-600 shadow-sm" : "border-slate-100 bg-white text-slate-500 hover:bg-slate-50"
                  }`}>
                  <Split className="w-4 h-4" /> {pkg.installment_count || 1} cuotas (${installmentAmountCalculated.toFixed(2)})
                </button>
              </div>
            </div>
          )}

          {!isUnlimited && !isChange && alreadyMidInstallments && (
            <div className="bg-amber-50 border border-amber-200/60 rounded-xl px-4 py-3 text-xs font-bold text-amber-800 flex items-center justify-between">
              <span>Pagando cuota en curso</span>
              <span className="bg-amber-200/60 px-2 py-0.5 rounded-md text-[11px]">
                {nextIndex} de {pkg.installment_count || 1}
              </span>
            </div>
          )}

          <div className="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-100 rounded-2xl p-4 text-center">
            <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest mb-1">
              {isInstantSwitchToUnlimited
                ? "Costo del cambio"
                : isUnlimited
                  ? `Total por ${creditsRequested} clase${creditsRequested !== 1 ? "s" : ""}`
                  : isChange
                    ? (isRefund ? "Monto a reembolsarte" : "Monto a transferir")
                    : useInstallments || alreadyMidInstallments
                      ? `Monto de la cuota ${alreadyMidInstallments ? nextIndex : 1}`
                      : "Monto total a transferir"}
            </p>
            <p className="text-3xl font-black text-pink-600">
              {isInstantSwitchToUnlimited ? "Gratis" : `$${amount.toFixed(2)} USD`}
            </p>
          </div>
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">
            {isRefund ? "Dónde enviarte el reembolso (opcional)" : "Mensaje de transacción (opcional)"}
          </label>
          <input
            type="text" value={reference} onChange={(e) => setReference(e.target.value)}
            placeholder={isRefund ? "Ej: mismo método con el que pagaste, cuenta, email de PayPal..." : "Ej: últimos 4 dígitos..."}
            disabled={isInstantSwitchToUnlimited}
            className="w-full bg-slate-50 border-2 border-transparent rounded-xl text-xs font-bold
                       text-slate-800 placeholder:text-slate-400 px-4 py-3.5 focus:outline-none
                       focus:bg-white focus:border-pink-500 focus:ring-4 focus:ring-pink-50 transition-all
                       disabled:opacity-50"
          />
        </div>
      </div>

      {/* Columna Derecha: Métodos de pago y botones de acción */}
      <div className="flex flex-col justify-between space-y-4">
        <div className="space-y-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {isRefund ? "Sobre tu reembolso" : "Métodos de pago disponibles"}
          </p>
          <div className="max-h-[300px] overflow-y-auto pr-1">
            {isInstantSwitchToUnlimited ? (
              <p className="text-xs text-slate-400 font-medium px-1">
                No aplica — este cambio no requiere pago.
              </p>
            ) : isRefund ? (
              <p className="text-xs text-slate-400 font-medium px-1">
                No necesitas transferir nada. El staff procesará la devolución y te contactará
                para coordinar el método de pago.
              </p>
            ) : (
              <PaymentMethodsInfo />
            )}
          </div>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold flex items-center gap-2">
            <X className="w-4 h-4 flex-shrink-0" /><span>{error}</span>
          </div>
        )}

        <div className="flex gap-3 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} disabled={sending}
            className="flex-1 py-3.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button type="button" onClick={notify} disabled={sending}
            className="flex-1 py-3.5 text-xs font-bold text-white rounded-xl bg-gradient-to-r
                       from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 shadow-lg
                       shadow-pink-200 active:scale-[0.98] transition-all duration-300 disabled:opacity-50
                       flex items-center justify-center gap-2">
            {sending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : isInstantSwitchToUnlimited
                ? <><Check className="w-4 h-4" /> Confirmar cambio</>
                : isRefund
                  ? <><Check className="w-4 h-4" /> Solicitar reembolso</>
                  : <><Check className="w-4 h-4" /> Ya realicé el pago</>}
          </button>
        </div>
      </div>
    </div>
  );
}