import { useState, useEffect, useCallback } from "react";

export interface User {
  id: number;
  openId: string;
  name?: string;
  email?: string;
  role?: string;
  accessToken?: string;
}

export interface UseAuthResult {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch("/api/trpc/auth.me");
      if (response.ok) {
        const data = await response.json();
        if (data.result?.data) {
          setUser(data.result.data);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = useCallback(() => {
    window.location.href = "/api/oauth/google";
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/trpc/auth.logout", { method: "POST" });
      setUser(null);
    } catch (error) {
      console.error("Failed to logout:", error);
    }
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    refresh: fetchUser,
  };
}
