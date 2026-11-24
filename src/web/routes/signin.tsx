import { SignInCard } from "../components/signin-card.tsx";
import { SignInLayout } from "../components/signin-layout.tsx";

export function SignInPage() {
  return (
    <SignInLayout mode="signin">
      <SignInCard />
    </SignInLayout>
  );
}
