import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useEffect } from "react";

interface User {
  email: string;
  name?: string;
  picture?: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: Error | null;
}

async function fetchUser(): Promise<User | null> {
  const response = await fetch("/api/auth/me");
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Failed to fetch user");
  }
  return response.json();
}

async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to logout");
  }
}

export function useAuth(options?: { redirectOnUnauthenticated?: boolean }) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { redirectOnUnauthenticated = false } = options ?? {};

  const { data: user, isLoading, error } = useQuery<User | null>({
    queryKey: ["auth", "me"],
    queryFn: fetchUser,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], null);
      setLocation("/login");
    },
  });

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (isLoading) return;
    if (user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === "/login") return;

    setLocation("/login");
  }, [redirectOnUnauthenticated, isLoading, user, setLocation]);

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: Boolean(user),
    error: error as Error | null,
    logout: () => logoutMutation.mutate(),
    refresh: () => queryClient.invalidateQueries({ queryKey: ["auth", "me"] }),
  } satisfies AuthState & { logout: () => void; refresh: () => void };
}

