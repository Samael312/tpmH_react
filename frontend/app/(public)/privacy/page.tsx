import type { Metadata } from "next";
import PrivacyContent from "@/components/legal/PrivacyContent";
import { getLandingDataServer } from "@/lib/landingServer";

export async function generateMetadata(): Promise<Metadata> {
  const data = await getLandingDataServer();
  const platformName = data?.platformName || "TuProfeMaria";
  return {
    title: `Política de Privacidad | ${platformName}`,
    description: `Política de Privacidad de ${platformName}`,
  };
}

export default function PrivacyPolicyPage() {
  return <PrivacyContent />;
}
