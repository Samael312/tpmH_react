export default function MobileOnly({ children }: { children: React.ReactNode }) {
  return <div className="block md:hidden">{children}</div>;
}