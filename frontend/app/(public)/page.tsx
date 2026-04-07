export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">TPMH</h1>
      <p className="text-gray-500 mt-2">Plataforma de clases particulares</p>
      <div className="flex gap-4 mt-8">
        <a href="/login" className="px-6 py-2 bg-black text-white rounded-lg">
          Iniciar sesión
        </a>
        <a href="/register" className="px-6 py-2 border rounded-lg">
          Registrarse
        </a>
      </div>
    </main>
  );
}