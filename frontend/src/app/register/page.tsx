import type { Metadata } from "next";
import { RedirectIfSignedIn } from "@/contexts/auth-context";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create your account" };

export default function RegisterPage() {
  return <RedirectIfSignedIn><AuthForm mode="register" /></RedirectIfSignedIn>;
}
