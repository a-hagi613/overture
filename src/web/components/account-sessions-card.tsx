import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { authClient } from "../lib/auth-client.ts";
import { downloadExport, fetchExportState, requestExport } from "../lib/export-api.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { dsCardTitle } from "./ui/ds.ts";

export function AccountSessionsCard({ email }: { email: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signedOutOthers, setSignedOutOthers] = useState(false);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const exportQuery = useQuery({
    queryFn: fetchExportState,
    queryKey: ["account-export"],
    refetchInterval: (query) => (query.state.data?.status === "preparing" ? 3000 : false),
    retry: false,
  });

  const exportMutation = useMutation({
    mutationFn: requestExport,
    onError: () => {
      toast.info(copy.nav.profilePages.exportErrorToast);
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["account-export"], result);
      toast.success(copy.nav.profilePages.exportStartedToast);
    },
  });

  const exportState = exportQuery.data;

  const handleExportClick = async () => {
    if (exportState?.status === "ready" && exportState.downloadUrl !== null) {
      setDownloading(true);

      try {
        await downloadExport(exportState.downloadUrl);
        toast.success(copy.nav.profilePages.exportReadyToast);
      } catch {
        toast.error(copy.settings.exportPage.downloadFailed);
      }

      setDownloading(false);

      return;
    }

    exportMutation.mutate();
  };

  const revokeOthers = async () => {
    setRevokingOthers(true);
    setRevokeError(null);

    try {
      const result = await authClient.revokeOtherSessions();

      if (result.error === null) {
        setSignedOutOthers(true);
        toast.success(copy.settings.signedOutMessage);
        setRevokingOthers(false);

        return;
      }

      setRevokeError(copy.settings.signOutThisError);
      toast.error(copy.settings.signOutThisError);
    } catch {
      setRevokeError(copy.settings.signOutThisError);
      toast.error(copy.settings.signOutThisError);
    }

    setRevokingOthers(false);
  };

  const signOutHere = async () => {
    setSigningOut(true);

    try {
      const result = await authClient.signOut();

      if (result.error === null) {
        queryClient.clear();
        await navigate("/signin");

        return;
      }

      toast.error(copy.settings.signOutThisError);
    } catch {
      toast.error(copy.settings.signOutThisError);
    }

    setSigningOut(false);
  };

  let exportButtonLabel: string = copy.settings.exportRowButton;

  if (downloading) {
    exportButtonLabel = copy.settings.exportPage.downloading;
  } else if (exportState?.status === "preparing" || exportMutation.isPending) {
    exportButtonLabel = copy.settings.exportPage.preparingButton;
  } else if (exportState?.status === "ready" && exportState.downloadUrl !== null) {
    exportButtonLabel = copy.settings.exportPage.readyButton;
  }

  return (
    <Card ariaLabelledBy="account-data" className="p-5 md:p-6">
      <h2 className={dsCardTitle} id="account-data">
        {copy.settings.accountHeading}
      </h2>
      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{email}</p>
      <div className="mt-4 divide-y divide-border">
        <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{copy.settings.exportRow}</p>
            <p className="text-xs text-muted-foreground">{copy.settings.exportRowDetail}</p>
          </div>
          <Button
            disabled={
              downloading || exportState?.status === "preparing" || exportMutation.isPending
            }
            onClick={() => {
              void handleExportClick();
            }}
            size="sm"
            variant="secondary"
          >
            <Download aria-hidden="true" size={14} />
            <span>{exportButtonLabel}</span>
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{copy.settings.signOutThis}</p>
            <p className="text-xs text-muted-foreground">{copy.settings.signOutThisDetail}</p>
          </div>
          <Button
            ariaBusy={signingOut}
            disabled={signingOut}
            onClick={() => {
              void signOutHere();
            }}
            size="sm"
            variant="secondary"
          >
            {signingOut ? copy.settings.signOutThisPending : copy.settings.signOutThisButton}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 py-3.5 last:pb-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{copy.settings.signOutAll}</p>
            <p className="text-xs text-muted-foreground">
              {signedOutOthers ? copy.settings.signedOutMessage : copy.settings.signOutAllDetail}
            </p>
            {revokeError === null ? null : (
              <p className="mt-1 text-xs font-semibold text-need" role="alert">
                {revokeError}
              </p>
            )}
          </div>
          <Button
            ariaBusy={revokingOthers}
            disabled={revokingOthers}
            onClick={() => {
              void revokeOthers();
            }}
            size="sm"
            variant="secondary"
          >
            {revokingOthers ? copy.settings.signOutThisPending : copy.settings.signOutAllButton}
          </Button>
        </div>
      </div>
    </Card>
  );
}
