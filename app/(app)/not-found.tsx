import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * The 404 inside the app — a bad path under an authenticated route.
 *
 * Different from the root not-found on purpose. Whoever sees this is already signed in
 * and mid-task, so it renders inside the normal shell with the sidebar and header still
 * there: the fastest recovery is the navigation they already know, not a marketing page
 * that makes them start again.
 */
export default function AppNotFound() {
  return (
    <div className="p-4 md:p-6">
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <FileQuestion className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-lg font-semibold">That page isn&apos;t here</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The link is out of date or the item was deleted. Your reminders are
              untouched.
            </p>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link href="/dashboard">
              <Button>Go to your dashboard</Button>
            </Link>
            <Link href="/reminders">
              <Button variant="outline">All reminders</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
