"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-base font-black text-slate-800 mb-2">{title}</h2>
      <div className="text-sm text-slate-600 leading-relaxed space-y-2">
        {children}
      </div>
    </section>
  );
}

type LegalSection = { title: string; body: ReactNode };

const MAIL_LINK = (
  <a
    href="mailto:soporte@mail.tuprofemaria.com"
    className="text-pink-600 font-semibold hover:underline"
  >
    soporte@mail.tuprofemaria.com
  </a>
);

const SECTIONS_ES: LegalSection[] = [
  {
    title: "1. Aceptación de los Términos",
    body: (
      <p>
        Estos Términos de Servicio (&quot;Términos&quot;) regulan el uso
        de la plataforma <strong>TuProfeMaria</strong>, disponible en{" "}
        <strong>tuprofemaria.com</strong> (&quot;la Plataforma&quot;),
        operada por <strong>María Farías</strong>, persona física con
        residencia fiscal en <strong>Venezuela</strong>. Al registrarte o
        usar la Plataforma, aceptás estos Términos en su totalidad. Si no
        estás de acuerdo, no debés usar la Plataforma.
      </p>
    ),
  },
  {
    title: "2. Qué es la Plataforma",
    body: (
      <>
        <p>
          TuProfeMaria es una plataforma que conecta estudiantes con
          profesores de idiomas o diversas áreas para clases individuales y grupales,
          gestiona la disponibilidad de los profesores, la reserva de
          clases, paquetes de crédito, tareas y materiales de estudio, y
          facilita la validación manual de pagos entre estudiantes y
          profesores.
        </p>
        <p>
          TuProfeMaria actúa como <strong>intermediario</strong> entre
          estudiantes y profesores independientes. No somos empleadores de
          los profesores ni garantizamos resultados académicos
          específicos.
        </p>
      </>
    ),
  },
  {
    title: "3. Registro y cuentas",
    body: (
      <ul className="list-disc pl-5 space-y-1">
        <li>Debés proporcionar información veraz, completa y actualizada al registrarte.</li>
        <li>Sos responsable de mantener la confidencialidad de tu contraseña y de toda actividad que ocurra en tu cuenta.</li>
        <li>La edad mínima para registrarse es <strong>14 años</strong>. Si tenés entre 14 y 17 años, solo podés usar la Plataforma con el consentimiento verificable de tu padre, madre o tutor legal, quien será responsable de tu actividad y de cualquier pago realizado.</li>
        <li>Nos reservamos el derecho de suspender o cancelar cuentas que incumplan estos Términos.</li>
      </ul>
    ),
  },
  {
    title: "4. Profesores",
    body: (
      <p>
        Los profesores se registran de forma independiente y su perfil
        queda sujeto a un proceso de aprobación (que incluye la
        presentación de un video de presentación). TuProfeMaria puede
        rechazar o suspender un perfil de profesor a su discreción. Los
        profesores son responsables del contenido y la calidad de las
        clases que imparten.
      </p>
    ),
  },
  {
    title: "5. Pagos, paquetes y cuotas",
    body: (
      <ul className="list-disc pl-5 space-y-1">
        <li>Los pagos se gestionan de forma <strong>manual</strong>: el estudiante sube un comprobante de pago, que es revisado y validado antes de acreditar el paquete o las clases.</li>
        <li>TuProfeMaria no procesa ni almacena datos de tarjetas de pago directamente.</li>
        <li>Los paquetes pueden pagarse en cuotas. El acceso a determinados beneficios puede estar condicionado a estar al día con las cuotas pendientes.</li>
        <li>Las políticas de cancelación, reprogramación y reembolso específicas se comunican dentro de la Plataforma y pueden variar según el profesor o el tipo de paquete contratado.</li>
      </ul>
    ),
  },
  {
    title: "6. Chipi (asistente con inteligencia artificial)",
    body: (
      <p>
        Chipi es un asistente virtual basado en inteligencia artificial
        que brinda ayuda general dentro de la Plataforma. Sus respuestas
        se generan automáticamente y pueden contener errores o
        imprecisiones. Chipi no reemplaza el criterio de un profesor
        humano ni constituye asesoría profesional de ningún tipo.
      </p>
    ),
  },
  {
    title: "7. Conducta del usuario",
    body: (
      <>
        <p>Al usar la Plataforma, te comprometés a no:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Usar la Plataforma para fines ilegales o no autorizados.</li>
          <li>Acosar, discriminar o comportarte de forma abusiva hacia otros usuarios.</li>
          <li>Intentar eludir el sistema de pagos o coordinar clases/pagos fuera de la Plataforma.</li>
          <li>Suplantar la identidad de otra persona o proporcionar información falsa.</li>
          <li>Intentar vulnerar la seguridad o interferir con el funcionamiento normal de la Plataforma.</li>
        </ul>
      </>
    ),
  },
  {
    title: "8. Propiedad intelectual",
    body: (
      <p>
        El nombre TuProfeMaria, su logo, diseño y el software subyacente
        son propiedad de María Farías / TuProfeMaria. Los materiales
        educativos subidos por los profesores siguen siendo propiedad de
        sus autores, quienes otorgan a TuProfeMaria una licencia limitada
        para almacenarlos y mostrarlos dentro de la Plataforma.
      </p>
    ),
  },
  {
    title: "9. Limitación de responsabilidad",
    body: (
      <p>
        La Plataforma se ofrece &quot;tal cual&quot; y &quot;según
        disponibilidad&quot;. En la medida permitida por la ley aplicable,
        TuProfeMaria no será responsable por daños indirectos,
        incidentales o consecuentes derivados del uso de la Plataforma.
        Nada en esta cláusula limita derechos que no puedan excluirse
        legalmente en tu jurisdicción.
      </p>
    ),
  },
  {
    title: "10. Suspensión y terminación",
    body: (
      <p>
        Podemos suspender o cancelar tu cuenta si incumplís estos
        Términos. También podés cerrar tu cuenta en cualquier momento
        contactándonos.
      </p>
    ),
  },
  {
    title: "11. Ley aplicable",
    body: (
      <p>
        Estos Términos se rigen por las leyes de Venezuela, sin perjuicio
        de los derechos imperativos de protección al consumidor y de
        protección de datos que puedan corresponderte según tu país de
        residencia.
      </p>
    ),
  },
  {
    title: "12. Cambios a estos Términos",
    body: (
      <p>
        Podemos actualizar estos Términos ocasionalmente, avisándote por
        correo o mediante un aviso en la Plataforma antes de que entren en
        vigor.
      </p>
    ),
  },
  {
    title: "13. Contacto",
    body: <p>Para cualquier consulta, escribinos a {MAIL_LINK}.</p>,
  },
];

const SECTIONS_EN: LegalSection[] = [
  {
    title: "1. Acceptance of Terms",
    body: (
      <p>
        These Terms of Service (&quot;Terms&quot;) govern the use of the{" "}
        <strong>TuProfeMaria</strong> platform, available at{" "}
        <strong>tuprofemaria.com</strong> (&quot;the Platform&quot;),
        operated by <strong>María Farías</strong>, a natural person with
        tax residency in <strong>Venezuela</strong>. By registering or
        using the Platform, you accept these Terms in full. If you do not
        agree, you must not use the Platform.
      </p>
    ),
  },
  {
    title: "2. What the Platform Is",
    body: (
      <>
        <p>
          TuProfeMaria is a platform that connects students with language
          teachers for individual and group classes, manages teacher
          availability, class booking, credit packages, homework and
          study materials, and facilitates manual payment validation
          between students and teachers.
        </p>
        <p>
          TuProfeMaria acts as an <strong>intermediary</strong> between
          students and independent teachers. We are not the teachers&apos;
          employer and do not guarantee specific academic outcomes.
        </p>
      </>
    ),
  },
  {
    title: "3. Registration and Accounts",
    body: (
      <ul className="list-disc pl-5 space-y-1">
        <li>You must provide truthful, complete, and up-to-date information when registering.</li>
        <li>You are responsible for keeping your password confidential and for all activity on your account.</li>
        <li>The minimum age to register is <strong>14</strong>. If you are between 14 and 17, you may only use the Platform with verifiable consent from a parent or legal guardian, who will be responsible for your activity and any payments made.</li>
        <li>We reserve the right to suspend or cancel accounts that violate these Terms.</li>
      </ul>
    ),
  },
  {
    title: "4. Teachers",
    body: (
      <p>
        Teachers register independently and their profile is subject to
        an approval process (including submitting a presentation video).
        TuProfeMaria may reject or suspend a teacher profile at its
        discretion. Teachers are responsible for the content and quality
        of the classes they teach.
      </p>
    ),
  },
  {
    title: "5. Payments, Packages, and Installments",
    body: (
      <ul className="list-disc pl-5 space-y-1">
        <li>Payments are handled <strong>manually</strong>: the student uploads a payment receipt, which is reviewed and validated before the package or classes are credited.</li>
        <li>TuProfeMaria does not process or store card payment data directly.</li>
        <li>Packages may be paid in installments. Access to certain benefits may be conditioned on being up to date with pending installments.</li>
        <li>Specific cancellation, rescheduling, and refund policies are communicated within the Platform and may vary by teacher or package type.</li>
      </ul>
    ),
  },
  {
    title: "6. Chipi (AI Assistant)",
    body: (
      <p>
        Chipi is a virtual assistant based on artificial intelligence that
        provides general help within the Platform. Its responses are
        generated automatically and may contain errors or inaccuracies.
        Chipi does not replace a human teacher&apos;s judgment or
        constitute professional advice of any kind.
      </p>
    ),
  },
  {
    title: "7. User Conduct",
    body: (
      <>
        <p>By using the Platform, you agree not to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Use the Platform for illegal or unauthorized purposes.</li>
          <li>Harass, discriminate against, or abuse other users.</li>
          <li>Attempt to bypass the payment system or arrange classes/payments outside the Platform.</li>
          <li>Impersonate another person or provide false information.</li>
          <li>Attempt to breach security or interfere with the normal operation of the Platform.</li>
        </ul>
      </>
    ),
  },
  {
    title: "8. Intellectual Property",
    body: (
      <p>
        The TuProfeMaria name, logo, design, and underlying software are
        the property of María Farías / TuProfeMaria. Educational
        materials uploaded by teachers remain the property of their
        authors, who grant TuProfeMaria a limited license to store and
        display them within the Platform.
      </p>
    ),
  },
  {
    title: "9. Limitation of Liability",
    body: (
      <p>
        The Platform is provided &quot;as is&quot; and &quot;as
        available&quot;. To the extent permitted by applicable law,
        TuProfeMaria is not liable for indirect, incidental, or
        consequential damages arising from use of the Platform. Nothing
        in this clause limits rights that cannot be legally excluded in
        your jurisdiction.
      </p>
    ),
  },
  {
    title: "10. Suspension and Termination",
    body: (
      <p>
        We may suspend or cancel your account if you violate these Terms.
        You may also close your account at any time by contacting us.
      </p>
    ),
  },
  {
    title: "11. Governing Law",
    body: (
      <p>
        These Terms are governed by the laws of Venezuela, without
        prejudice to mandatory consumer protection and data protection
        rights that may apply to you based on your country of residence.
      </p>
    ),
  },
  {
    title: "12. Changes to These Terms",
    body: (
      <p>
        We may update these Terms from time to time, notifying you by
        email or through a notice within the Platform before they take
        effect.
      </p>
    ),
  },
  {
    title: "13. Contact",
    body: <p>For any question, write to us at {MAIL_LINK}.</p>,
  },
];

export default function TermsContent() {
  const [lang, setLang] = useState<"es" | "en">("es");
  const sections = lang === "es" ? SECTIONS_ES : SECTIONS_EN;
  const lastUpdated =
    lang === "es"
      ? "Última actualización: 4 de septiembre de 2026"
      : "Last updated: September 4, 2026";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col relative overflow-hidden font-sans">
      <header className="relative z-20 h-16 px-6 bg-white/70 backdrop-blur-md border-b border-white/50 flex items-center justify-between shadow-sm">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="p-1.5 bg-pink-50 rounded-lg group-hover:bg-pink-100 transition-colors">
            <svg className="w-6 h-6 text-pink-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
          </div>
          <span className="text-xl font-black tracking-tight text-slate-800 group-hover:text-pink-600 transition-colors">
            TuProfeMaria
          </span>
        </Link>

        <div className="flex bg-slate-100 rounded-full p-1 text-xs font-bold">
          <button
            onClick={() => setLang("es")}
            className={`px-3 py-1 rounded-full transition-colors ${lang === "es" ? "bg-white text-pink-600 shadow-sm" : "text-slate-400"}`}
          >
            ES
          </button>
          <button
            onClick={() => setLang("en")}
            className={`px-3 py-1 rounded-full transition-colors ${lang === "en" ? "bg-white text-pink-600 shadow-sm" : "text-slate-400"}`}
          >
            EN
          </button>
        </div>
      </header>

      <div className="absolute top-[-100px] right-[-100px] w-[500px] h-[500px] bg-pink-300/25 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-100px] left-[-100px] w-[400px] h-[400px] bg-rose-300/20 rounded-full blur-[100px] pointer-events-none" />

      <main className="flex-1 flex justify-center px-4 py-10 relative z-10">
        <div className="w-full max-w-3xl animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-white/90 backdrop-blur-xl rounded-[1.5rem] border border-white shadow-2xl shadow-slate-200/50 p-6 sm:p-10">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight mb-1">
              {lang === "es" ? "Términos de Servicio" : "Terms of Service"}
            </h1>
            <p className="text-xs text-slate-400 font-semibold mb-8">{lastUpdated}</p>

            {sections.map((s) => (
              <Section key={s.title} title={s.title}>
                {s.body}
              </Section>
            ))}

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
              <Link href="/privacy" className="text-pink-600 font-bold hover:underline">
                {lang === "es" ? "Ver Política de Privacidad →" : "View Privacy Policy →"}
              </Link>
              <Link href="/" className="text-slate-400 hover:text-slate-600">
                {lang === "es" ? "Volver al inicio" : "Back to home"}
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
