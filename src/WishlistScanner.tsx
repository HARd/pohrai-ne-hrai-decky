import {
  ButtonItem,
  Field,
  PanelSection,
  PanelSectionRow,
  Spinner
} from "decky-frontend-lib";
import { FC, useState } from "react";
import { AppStatus } from "./types";
import { t } from "./i18n";

interface WishlistScannerProps {
  getAppStatus: (appid: string) => Promise<AppStatus>;
  lang: string;
}

export const WishlistScanner: FC<WishlistScannerProps> = ({ getAppStatus, lang }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [hostileGames, setHostileGames] = useState<AppStatus[]>([]);
  const [scanComplete, setScanComplete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const getSessionId = async () => {
    try {
      const res = await fetch("https://store.steampowered.com/", { credentials: "include" });
      const text = await res.text();
      const match = text.match(/g_sessionID\s*=\s*"([^"]+)"/);
      return match ? match[1] : null;
    } catch (e) {
      console.error("Failed to get sessionID", e);
      return null;
    }
  };

  const scanWishlist = async () => {
    setIsScanning(true);
    setScanComplete(false);
    setScannedCount(0);
    setTotalCount(0);
    setHostileGames([]);

    try {
      const res = await fetch("https://store.steampowered.com/dynamicstore/userdata/", {
        credentials: "include"
      });
      const data = await res.json();
      
      const appids: number[] = data.rgWishlist || [];
      setTotalCount(appids.length);

      const foundHostiles: AppStatus[] = [];

      for (let i = 0; i < appids.length; i++) {
        const appid = String(appids[i]);
        const status = await getAppStatus(appid);
        
        if (status.type === "hostile") {
          foundHostiles.push(status);
          setHostileGames([...foundHostiles]);
        }
        
        setScannedCount(i + 1);
      }
      
      setScanComplete(true);
    } catch (e) {
      console.error("Failed to scan wishlist", e);
    } finally {
      setIsScanning(false);
    }
  };

  const removeHostileGames = async () => {
    const sessionId = await getSessionId();
    if (!sessionId) {
      console.error("Could not find session ID");
      return;
    }

    setIsDeleting(true);
    try {
      for (const game of hostileGames) {
        const formData = new FormData();
        formData.append("sessionid", sessionId);
        formData.append("appid", game.appid);

        await fetch("https://store.steampowered.com/api/removefromwishlist", {
          method: "POST",
          credentials: "include",
          body: formData
        });
      }
      // Clear list after successful deletion
      setHostileGames([]);
    } catch (e) {
      console.error("Failed to remove games", e);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <PanelSection title={t(lang, "section_wishlist")}>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={scanWishlist}
          disabled={isScanning || isDeleting}
        >
          {isScanning ? t(lang, "wishlist_scanning", { c: scannedCount, t: totalCount }) : t(lang, "wishlist_scan")}
        </ButtonItem>
      </PanelSectionRow>

      {isScanning && (
        <PanelSectionRow>
          <div style={{ display: "flex", justifyContent: "center", padding: "10px" }}>
            <Spinner />
          </div>
        </PanelSectionRow>
      )}

      {scanComplete && hostileGames.length === 0 && (
        <PanelSectionRow>
          <Field description="">{t(lang, "wishlist_clean")}</Field>
        </PanelSectionRow>
      )}

      {hostileGames.length > 0 && (
        <>
          <PanelSectionRow>
            <div style={{ padding: "10px 0" }}>
              <strong>{t(lang, "wishlist_found", { c: hostileGames.length })}:</strong>
              <ul style={{ paddingLeft: "20px", marginTop: "10px" }}>
                {hostileGames.map(g => (
                  <li key={g.appid}>
                    {(g as any).name || `App ${g.appid}`}
                  </li>
                ))}
              </ul>
            </div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={removeHostileGames}
              disabled={isDeleting}
            >
              {isDeleting ? t(lang, "wishlist_removing") : t(lang, "wishlist_remove")}
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}
    </PanelSection>
  );
};
