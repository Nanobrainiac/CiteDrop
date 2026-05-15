import { UserButton } from '@clerk/clerk-react';

export default function ClerkUserButton() {
  return <UserButton afterSignOutUrl="/" />;
}
