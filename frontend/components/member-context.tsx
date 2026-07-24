"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { api } from "@/services/api";
import type { Member } from "@/types";

interface AuthContextValue {
  currentMember: Member | null; // the logged-in family member
  members: Member[]; // all members (for dropdowns / family page)
  loading: boolean;
  refresh: () => Promise<void>; // refetch the members list
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useMembers(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useMembers must be used within <MemberProvider>");
  return ctx;
}

export function MemberProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [currentMember, setCurrentMember] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMembers(await api.members.list());
    } catch {
      /* ignore — surfaced by the pages that need it */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.auth.me();
        setCurrentMember(me);
        await refresh();
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh, router]);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* ignore */
    }
    router.replace("/login");
    router.refresh();
  }, [router]);

  return (
    <AuthContext.Provider
      value={{ currentMember, members, loading, refresh, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
