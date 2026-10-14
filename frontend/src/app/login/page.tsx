import type { Metadata } from "next";
import { RedirectIfSignedIn } from "@/contexts/auth-context";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return <RedirectIfSignedIn><AuthForm mode="login" /></RedirectIfSignedIn>;
}
