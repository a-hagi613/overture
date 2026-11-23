import { SignInCard } from "../components/signin-card.tsx";
import { SignInLayout } from "../components/signin-layout.tsx";

export function SignUpPage() {
  return (
    <SignInLayout>
      <SignInCard mode="signup" />
    </SignInLayout>
  );
}
