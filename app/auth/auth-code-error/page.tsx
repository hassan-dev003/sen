import Link from "next/link";

export default function AuthCodeErrorPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold">Sign-in link expired</h1>
      <p className="text-sm opacity-70">
        That link could not be used. It may have already been opened or timed
        out.
      </p>
      <Link href="/login" className="text-sm underline">
        Request a new link
      </Link>
    </main>
  );
}
