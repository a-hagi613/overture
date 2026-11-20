export interface IdentityPersona {
  sub: string;
  name: string;
  email: string;
  emailVerified: boolean;
  picture: string | null;
}
