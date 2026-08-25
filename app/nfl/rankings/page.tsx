import { redirect } from "next/navigation";

// The rankings now live at /rankings (with sport tabs).
export default function NflRankingsRedirect() {
  redirect("/rankings?tab=nfl");
}
