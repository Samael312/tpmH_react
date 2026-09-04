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

const GOOGLE_POLICY_LINK_ES = (
  <a
    href="https://developers.google.com/terms/api-services-user-data-policy"
    target="_blank"
    rel="noopener noreferrer"
    className="text-pink-600 hover:underline not-italic"
  >
    Política de Datos de Usuario de los Servicios de API de Google
  </a>
);

const GOOGLE_POLICY_LINK_EN = (
  <a
    href="https://developers.google.com/terms/api-services-user-data-policy"
    target="_blank"
    rel="noopener noreferrer"
    className="text-pink-600 hover:underline not-italic"
  >
    Google API Services User Data Policy
  </a>
);

const SECTIONS_ES: LegalSection[] = [
  {
    title: "1. Responsable del tratamiento",
    body: (
      <>
        <p>
          Esta plataforma (&quot;TuProfeMaria&quot;, &quot;la
          Plataforma&quot;, &quot;nosotros&quot;) es operada por{" "}
          <strong>María Farías</strong>, persona física, con residencia
          fiscal en <strong>Venezuela</strong>, actuando bajo el nombre
          comercial <strong>TuProfeMaria</strong>, accesible en{" "}
          <strong>tuprofemaria.com</strong>.
        </p>
        <p>
          Para cualquier consulta relacionada con esta Política de
          Privacidad o el tratamiento de tus datos personales, podés
          escribirnos a {MAIL_LINK}.
        </p>
      </>
    ),
  },
  {
    title: "2. Qué datos recopilamos",
    body: (
      <>
        <p>Recopilamos los siguientes tipos de datos, según tu rol y uso de la Plataforma:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Datos de cuenta:</strong> nombre, apellido, correo electrónico, nombre de usuario, contraseña (almacenada siempre cifrada, nunca en texto plano), teléfono, nacionalidad, zona horaria y foto de perfil.</li>
          <li><strong>Inicio de sesión con Google:</strong> si elegís registrarte o iniciar sesión con tu cuenta de Google, recibimos tu identificador de cuenta de Google, nombre, correo y foto de perfil pública.</li>
          <li><strong>Sincronización de Google Calendar (solo profesores):</strong> si un profesor conecta voluntariamente su Google Calendar, accedemos a su disponibilidad (eventos, horarios ocupados) y creamos eventos correspondientes a las clases agendadas en la Plataforma. Esta conexión es opcional y puede desactivarse en cualquier momento desde tu perfil.</li>
          <li><strong>Datos de pago:</strong> como los pagos se validan de forma manual, no procesamos ni almacenamos números de tarjeta. Sí almacenamos el comprobante de pago que subís (imagen), el método de pago declarado, un identificador de transacción si aplica, y el historial de pagos/cuotas asociado a tu cuenta.</li>
          <li><strong>Datos específicos de profesores:</strong> biografía, título, idiomas, materias, habilidades, certificados, video de presentación, enlaces a redes sociales, e información de balance/ganancias dentro de la Plataforma.</li>
          <li><strong>Comunicación con Chipi (asistente con IA):</strong> los mensajes que le escribís a Chipi se procesan a través de un proveedor externo de inteligencia artificial (OpenAI) para generar una respuesta.</li>
          <li><strong>Audio generado por texto a voz:</strong> cuando se genera pronunciación de palabras/frases, el texto se procesa a través de un proveedor externo (OpenAI) y el audio resultante se almacena en nuestro proveedor de almacenamiento en la nube.</li>
          <li><strong>Tickets de soporte:</strong> el contenido de cualquier consulta, duda o reporte de error que nos envíes.</li>
          <li><strong>Datos técnicos y de uso:</strong> registros de errores de la aplicación (mensaje, pantalla en la que ocurrió, y datos técnicos asociados) que usamos únicamente para diagnosticar y corregir fallos.</li>
          <li><strong>Cookie de sesión:</strong> usamos una única cookie estrictamente necesaria para mantener tu sesión iniciada (token de autenticación). No usamos cookies de publicidad ni de seguimiento de terceros.</li>
        </ul>
      </>
    ),
  },
  {
    title: "3. Para qué usamos tus datos",
    body: (
      <ul className="list-disc pl-5 space-y-1">
        <li>Crear y gestionar tu cuenta y tu perfil.</li>
        <li>Conectar estudiantes con profesores, agendar, reprogramar y gestionar clases individuales y grupales.</li>
        <li>Procesar y validar manualmente tus pagos, y gestionar paquetes, cuotas y renovaciones.</li>
        <li>Sincronizar la disponibilidad del profesor con su Google Calendar, cuando lo haya conectado voluntariamente.</li>
        <li>Brindar soporte y responder tus consultas.</li>
        <li>Enviar notificaciones y correos transaccionales relacionados con tu actividad en la Plataforma.</li>
        <li>Detectar y prevenir fraude, abuso o incumplimientos de nuestros Términos de Servicio.</li>
        <li>Cumplir con obligaciones legales aplicables.</li>
      </ul>
    ),
  },
  {
    title: "4. Base legal del tratamiento (usuarios en la Unión Europea/EEE)",
    body: (
      <p>
        Si accedés a la Plataforma desde la Unión Europea o el Espacio
        Económico Europeo, tratamos tus datos sobre la base de: la
        ejecución de un contrato, tu consentimiento expreso (por ejemplo,
        al conectar tu Google Calendar), nuestro interés legítimo
        (seguridad, prevención de fraude, mejora del servicio), y el
        cumplimiento de obligaciones legales.
      </p>
    ),
  },
  {
    title: "5. Con quién compartimos tus datos",
    body: (
      <>
        <p>No vendemos tus datos personales. Los compartimos únicamente con proveedores que nos ayudan a operar la Plataforma:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>OpenAI</strong> — respuestas de Chipi y audio de pronunciación.</li>
          <li><strong>Google</strong> — inicio de sesión y sincronización de Google Calendar.</li>
          <li><strong>Cloudinary</strong> — almacenamiento de imágenes, videos y audios.</li>
          <li><strong>Resend</strong> — envío de correos transaccionales.</li>
          <li>Nuestro proveedor de hosting y base de datos.</li>
        </ul>
        <p className="mt-2">También podemos divulgar datos si la ley lo exige, o para proteger derechos, seguridad o propiedad de TuProfeMaria, sus usuarios o terceros.</p>
        <p className="mt-2 text-slate-500 italic">
          El uso y la transferencia de información recibida a través de las
          APIs de Google por parte de TuProfeMaria se adhiere a la{" "}
          {GOOGLE_POLICY_LINK_ES}, incluyendo los requisitos de Uso Limitado
          (Limited Use).
        </p>
      </>
    ),
  },
  {
    title: "6. Transferencias internacionales",
    body: (
      <p>
        Dado que operamos desde Venezuela con usuarios en la Unión Europea,
        Latinoamérica y otras regiones, y usamos proveedores con
        infraestructura en distintos países (incluido Estados Unidos), tus
        datos pueden transferirse internacionalmente. Cuando aplique, nos
        apoyamos en las salvaguardas contractuales que ofrecen dichos
        proveedores (por ejemplo, cláusulas contractuales tipo).
      </p>
    ),
  },
  {
    title: "7. Cuánto tiempo conservamos tus datos",
    body: (
      <p>
        Conservamos tus datos mientras tu cuenta esté activa y mientras
        sean necesarios para los fines descritos, o para cumplir
        obligaciones legales, fiscales o contables. Si solicitás la
        eliminación de tu cuenta, eliminamos o anonimizamos tus datos
        personales salvo aquellos que debamos conservar por obligación
        legal.
      </p>
    ),
  },
  {
    title: "8. Tus derechos",
    body: (
      <>
        <p>
          Según tu ubicación, podés tener derecho a: acceder a tus datos,
          rectificarlos, solicitar su eliminación, oponerte u obtener la
          limitación de su tratamiento, y solicitar la portabilidad de tus
          datos. Si sos residente de la Unión Europea/EEE, estos derechos
          derivan del RGPD.
        </p>
        <p>Podés ejercer estos derechos escribiéndonos a {MAIL_LINK}.</p>
      </>
    ),
  },
  {
    title: "9. Menores de edad",
    body: (
      <p>
        La Plataforma está dirigida principalmente a personas mayores de
        18 años. Permitimos el registro de menores a partir de{" "}
        <strong>14 años</strong>, siempre que cuenten con el consentimiento
        verificable de su padre, madre o tutor legal. Si sos menor de 14
        años, no debés registrarte ni usar la Plataforma.
      </p>
    ),
  },
  {
    title: "10. Cookies",
    body: (
      <p>
        Usamos exclusivamente una cookie técnica/funcional para mantener
        tu sesión iniciada de forma segura. No utilizamos cookies de
        publicidad ni de seguimiento de terceros.
      </p>
    ),
  },
  {
    title: "11. Seguridad",
    body: (
      <p>
        Aplicamos medidas técnicas y organizativas razonables para
        proteger tus datos. Sin embargo, ningún sistema es 100% infalible,
        por lo que no podemos garantizar seguridad absoluta.
      </p>
    ),
  },
  {
    title: "12. Cambios a esta Política",
    body: (
      <p>
        Podemos actualizar esta Política ocasionalmente. Si los cambios
        son significativos, te lo notificaremos por correo electrónico o
        mediante un aviso dentro de la Plataforma antes de que entren en
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
    title: "1. Data Controller",
    body: (
      <>
        <p>
          This platform (&quot;TuProfeMaria&quot;, &quot;the
          Platform&quot;, &quot;we&quot;) is operated by{" "}
          <strong>María Farías</strong>, a natural person with tax
          residency in <strong>Venezuela</strong>, doing business as{" "}
          <strong>TuProfeMaria</strong>, available at{" "}
          <strong>tuprofemaria.com</strong>.
        </p>
        <p>
          For any question about this Privacy Policy or how we process
          your personal data, you can reach us at {MAIL_LINK}.
        </p>
      </>
    ),
  },
  {
    title: "2. What Data We Collect",
    body: (
      <>
        <p>We collect the following types of data, depending on your role and use of the Platform:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Account data:</strong> first name, last name, email address, username, password (always stored encrypted, never in plain text), phone number, nationality, timezone, and profile photo.</li>
          <li><strong>Google Sign-In:</strong> if you choose to register or log in with your Google account, we receive your Google account identifier, name, email, and public profile photo.</li>
          <li><strong>Google Calendar sync (teachers only):</strong> if a teacher voluntarily connects their Google Calendar, we access their availability (events, busy times) and create events for classes booked on the Platform. This connection is optional and can be turned off anytime from your profile.</li>
          <li><strong>Payment data:</strong> since payments are validated manually, we do not process or store card numbers directly. We do store the payment receipt you upload (image), the declared payment method, a transaction ID when applicable, and your payment/installment history.</li>
          <li><strong>Teacher-specific data:</strong> bio, title, languages, subjects, skills, certificates, presentation video, social media links, and balance/earnings information within the Platform.</li>
          <li><strong>Chipi (AI assistant) conversations:</strong> messages you send to Chipi are processed through a third-party AI provider (OpenAI) to generate a response.</li>
          <li><strong>Text-to-speech audio:</strong> when pronunciation audio is generated, the text is processed through a third-party provider (OpenAI) and the resulting audio is stored with our cloud storage provider.</li>
          <li><strong>Support tickets:</strong> the content of any inquiry, question, or bug report you send us.</li>
          <li><strong>Technical and usage data:</strong> application error logs (message, screen where it occurred, and related technical data) used solely to diagnose and fix issues.</li>
          <li><strong>Session cookie:</strong> we use a single strictly necessary cookie to keep you logged in (authentication token). We do not use advertising or third-party tracking cookies.</li>
        </ul>
      </>
    ),
  },
  {
    title: "3. How We Use Your Data",
    body: (
      <ul className="list-disc pl-5 space-y-1">
        <li>Create and manage your account and profile.</li>
        <li>Connect students with teachers, and schedule, reschedule, and manage individual and group classes.</li>
        <li>Manually process and validate your payments, and manage packages, installments, and renewals.</li>
        <li>Sync a teacher&apos;s availability with their Google Calendar, when voluntarily connected.</li>
        <li>Provide support and respond to your inquiries.</li>
        <li>Send notifications and transactional emails related to your activity on the Platform.</li>
        <li>Detect and prevent fraud, abuse, or violations of our Terms of Service.</li>
        <li>Comply with applicable legal obligations.</li>
      </ul>
    ),
  },
  {
    title: "4. Legal Basis for Processing (EU/EEA Users)",
    body: (
      <p>
        If you access the Platform from the European Union or the
        European Economic Area, we process your data based on: contract
        performance, your explicit consent (e.g., when connecting your
        Google Calendar), our legitimate interest (security, fraud
        prevention, service improvement), and compliance with legal
        obligations.
      </p>
    ),
  },
  {
    title: "5. Who We Share Your Data With",
    body: (
      <>
        <p>We do not sell your personal data. We only share it with providers that help us operate the Platform:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>OpenAI</strong> — Chipi responses and pronunciation audio.</li>
          <li><strong>Google</strong> — sign-in and Google Calendar sync.</li>
          <li><strong>Cloudinary</strong> — storage of images, videos, and audio.</li>
          <li><strong>Resend</strong> — transactional email delivery.</li>
          <li>Our hosting and database provider.</li>
        </ul>
        <p className="mt-2">We may also disclose data when required by law, or to protect the rights, safety, or property of TuProfeMaria, our users, or third parties.</p>
        <p className="mt-2 text-slate-500 italic">
          TuProfeMaria&apos;s use and transfer of information received
          from Google APIs adheres to the {GOOGLE_POLICY_LINK_EN},
          including the Limited Use requirements.
        </p>
      </>
    ),
  },
  {
    title: "6. International Transfers",
    body: (
      <p>
        Since we operate from Venezuela with users in the European Union,
        Latin America, and other regions, and we use providers with
        infrastructure in different countries (including the United
        States), your data may be transferred internationally. Where
        applicable, we rely on contractual safeguards offered by those
        providers (e.g., standard contractual clauses).
      </p>
    ),
  },
  {
    title: "7. How Long We Keep Your Data",
    body: (
      <p>
        We keep your data while your account is active and as needed for
        the purposes described above, or to comply with legal, tax, or
        accounting obligations. If you request account deletion, we
        delete or anonymize your personal data except what we must retain
        by legal obligation.
      </p>
    ),
  },
  {
    title: "8. Your Rights",
    body: (
      <>
        <p>
          Depending on your location, you may have the right to: access
          your data, correct it, request its deletion, object to or
          restrict its processing, and request data portability. If you
          are an EU/EEA resident, these rights derive from the GDPR.
        </p>
        <p>You can exercise these rights by writing to {MAIL_LINK}.</p>
      </>
    ),
  },
  {
    title: "9. Minors",
    body: (
      <p>
        The Platform is primarily intended for people over 18. We allow
        registration from <strong>age 14</strong>, provided there is
        verifiable consent from a parent or legal guardian. If you are
        under 14, you must not register or use the Platform.
      </p>
    ),
  },
  {
    title: "10. Cookies",
    body: (
      <p>
        We use exclusively one functional/technical cookie to keep you
        securely logged in. We do not use advertising or third-party
        tracking cookies.
      </p>
    ),
  },
  {
    title: "11. Security",
    body: (
      <p>
        We apply reasonable technical and organizational measures to
        protect your data. However, no system is 100% infallible, so we
        cannot guarantee absolute security.
      </p>
    ),
  },
  {
    title: "12. Changes to This Policy",
    body: (
      <p>
        We may update this Policy from time to time. If changes are
        significant, we will notify you by email or through a notice
        within the Platform before they take effect.
      </p>
    ),
  },
  {
    title: "13. Contact",
    body: <p>For any question, write to us at {MAIL_LINK}.</p>,
  },
];

export default function PrivacyContent() {
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
              {lang === "es" ? "Política de Privacidad" : "Privacy Policy"}
            </h1>
            <p className="text-xs text-slate-400 font-semibold mb-8">{lastUpdated}</p>

            {sections.map((s) => (
              <Section key={s.title} title={s.title}>
                {s.body}
              </Section>
            ))}

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
              <Link href="/terms" className="text-pink-600 font-bold hover:underline">
                {lang === "es" ? "Ver Términos de Servicio →" : "View Terms of Service →"}
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
