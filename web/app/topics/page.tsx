import { permanentRedirect } from "next/navigation";

// The topics are the opening view of the app.
export default function TopicsIndex() {
  permanentRedirect("/");
}
