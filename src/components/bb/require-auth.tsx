import { useEffect, type ReactNode } from "react";

import { useNavigate } from "@tanstack/react-router";

import { useUser, type Role } from "@/lib/store";

interface RequireAuthProps {
  children: ReactNode;

  /**
   * Optional role restriction.
   *
   * Example:
   * <RequireAuth role="donor">
   */
  role?: Role;
}

export function RequireAuth({ children, role }: RequireAuthProps) {
  const user = useUser();

  const navigate = useNavigate();

  useEffect(() => {
    if (!user) {
      navigate({
        to: "/login",
        replace: true,
      });

      return;
    }

    if (role && user.role !== role) {
      navigate({
        to: "/dashboard",
        replace: true,
      });
    }
  }, [user, role, navigate]);

  if (!user) {
    return null;
  }

  if (role && user.role !== role) {
    return null;
  }

  return <>{children}</>;
}
