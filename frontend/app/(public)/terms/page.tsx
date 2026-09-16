import type { Metadata } from "next";
import TermsContent from "@/components/legal/TermsContent";
import { getLandingDataServer } from "@/lib/landingServer";

export async function generateMetadata(): Promise<Metadata> {
  const data = await getLandingDataServer();
  const platformName = data?.platformName || "TuProfeMaria";
  return {
    title: `Términos de Servicio | ${platformName}`,
    description: `Términos y Condiciones de Servicio de ${platformName}`,
  };
}

export default function TermsOfServicePage() {
  return <TermsContent />;
}
