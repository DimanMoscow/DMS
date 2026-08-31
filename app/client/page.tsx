import type { Metadata } from "next";
import { ClientPortal } from "./client-portal";

export const metadata: Metadata = {
  title: "Личный кабинет — DMS Fitness",
  description: "Профиль и динамика замеров клиента DMS Fitness",
};

export default function ClientPortalPage() {
  return <ClientPortal />;
}
