import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadDmSans } from "@remotion/google-fonts/DMSans";

// Misma paleta y tipografías que la web (frontend/tailwind.config.ts y app/layout.tsx).
export const colors = {
  primary: "#E91E8C",
  primaryLight: "#F06DB3",
  primaryDark: "#C0166F",
  rose: "#FB7185",
  ink: "#1a1a2e",
  inkMuted: "#6B7280",
  inkSubtle: "#9CA3AF",
  surface: "#FFFFFF",
  surfaceSoft: "#F8F9FA",
  surfaceMuted: "#F1F3F5",
  pink50: "#FDF2F8",
  pink100: "#FCE7F3",
  purple: "#9333EA",
  purpleSoft: "#A855F7",
  green: "#22C55E",
  amber: "#F59E0B",
  blue: "#3B82F6",
} as const;

export const gradients = {
  brand: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.rose} 100%)`,
  brandPurple: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.purpleSoft} 100%)`,
  softBg: `linear-gradient(160deg, #FFF5FA 0%, #FDF2F8 45%, #F5F3FF 100%)`,
} as const;

const poppins = loadPoppins("normal", { weights: ["600", "700", "800"], subsets: ["latin", "latin-ext"] });
const dmSans = loadDmSans("normal", { weights: ["400", "500", "700"], subsets: ["latin", "latin-ext"] });

export const fonts = {
  display: poppins.fontFamily,
  sans: dmSans.fontFamily,
} as const;

export const FPS = 30;
