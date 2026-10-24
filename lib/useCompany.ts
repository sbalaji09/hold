"use client";
// Client components' view of who hold works for. Fogline until Convex answers (or with no Convex).
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { companyFor, type Company } from "./company";

const FALLBACK = companyFor(undefined);

export function useCompany(): Company {
  return useQuery(api.app.company.current, {}) ?? FALLBACK;
}
