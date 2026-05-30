import {
  ButtonItem,
  Field,
  PanelSection,
  PanelSectionRow,
  Spinner
} from "@decky/ui";
import { toaster } from "@decky/api";
import { FC, useState } from "react";
import { AppStatus } from "./types";
import { t, Language } from "./i18n";

interface WishlistScannerProps {
  getAppStatus: (appid: string) => Promise<AppStatus>;
  lang: Language;
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
      const win = window as any;
      if (win.g_sessionID) return win.g_sessionID;
      if (win.SteamClient?.User?.GetSessionID) return win.SteamClient.User.GetSessionID();
      if (win.SteamClient?.Auth?.GetSessionID) return win.SteamClient.Auth.GetSessionID();
      if (win.SteamClient?.UserStore?.sessionid) return win.SteamClient.UserStore.sessionid;

      const matchCookie = document.cookie.match(/sessionid=([^;]+)/);
      if (matchCookie) return matchCookie[1];

      // Fallback to fetch (often blocked by CSP on Steam Deck)
      let res = await fetch("https://store.steampowered.com/", { credentials: "include" });
      let text = await res.text();
      let match = text.match(/g_sessionID\s*=\s*"([^"]+)"/) || text.match(/data-sessionid="([^"]+)"/) || text.match(/sessionid=([^;"]+)/);
      if (match) return match[1];

      res = await fetch("https://steamcommunity.com/", { credentials: "include" });
      text = await res.text();
      match = text.match(/g_sessionID\s*=\s*"([^"]+)"/) || text.match(/data-sessionid="([^"]+)"/) || text.match(/sessionid=([^;"]+)/);
      if (match) return match[1];

      console.error("Could not find sessionID in HTML. Lengths:", text.length);
      toaster.toast({
        title: "Помилка Wishlist",
        body: "Не вдалося знайти sessionID локально або через fetch.",
        duration: 4000,
      });
      return null;
    } catch (e: any) {
      console.error("Failed to get sessionID", e);
      toaster.toast({
        title: "Помилка доступу (CSP/CORS)",
        body: "Браузер Steam Deck блокує запит. Спробуйте вручну.",
        duration: 4000,
      });
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
      const res = await fetch(`https://store.steampowered.com/dynamicstore/userdata/?_=${Date.now()}`, {
        credentials: "include",
        cache: "no-store"
      });
      const data = await res.json();
      
      const appids: number[] = data.rgWishlist || [];
      setTotalCount(appids.length);

      const foundHostiles: AppStatus[] = [];

      const CHUNK_SIZE = 10;
      let completed = 0;

      for (let i = 0; i < appids.length; i += CHUNK_SIZE) {
        const chunk = appids.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (numAppid) => {
            const appid = String(numAppid);
            const status = await getAppStatus(appid);
            
            if (status.type === "hostile") {
              foundHostiles.push(status);
            }
            completed++;
            setScannedCount(completed);
          })
        );
        // Оновлюємо стан після кожного чанка, щоб не перевантажувати React
        setHostileGames([...foundHostiles]);
      }
      
      setScanComplete(true);
    } catch (e) {
      console.error("Failed to scan wishlist", e);
    } finally {
      setIsScanning(false);
    }
  };

  const removeHostileGames = async () => {
    setIsDeleting(true);
    try {
      const win = window as any;
      
      // 1. Try native Steam API first
      if (win.SteamClient?.Store?.SetWishlist) {
        for (const game of hostileGames) {
          await win.SteamClient.Store.SetWishlist(parseInt(game.appid), false);
        }
        setHostileGames([]);
        toaster.toast({ title: "Успіх", body: "Ігри видалено через Steam API!", duration: 4000 });
        setIsDeleting(false);
        return;
      }
      if (win.SteamClient?.StoreItems?.SetWishlist) {
        for (const game of hostileGames) {
          await win.SteamClient.StoreItems.SetWishlist(parseInt(game.appid), false);
        }
        setHostileGames([]);
        toaster.toast({ title: "Успіх", body: "Ігри видалено через StoreItems API!", duration: 4000 });
        setIsDeleting(false);
        return;
      }

      // 2. Fallback to raw fetch if sessionID can be found
      const sessionId = await getSessionId();
      if (!sessionId) {
        setIsDeleting(false);
        return;
      }
      for (const game of hostileGames) {
        await fetch("https://store.steampowered.com/api/removefromwishlist", {
          method: "POST",
          credentials: "include",
          mode: "no-cors",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: `sessionid=${sessionId}&appid=${game.appid}`
        });
      }
      // Control check: verify if the games actually disappeared
      const checkRes = await fetch(`https://store.steampowered.com/dynamicstore/userdata/?_=${Date.now()}`, {
        credentials: "include",
        cache: "no-store"
      });
      const checkData = await checkRes.json();
      const currentWishlist: number[] = checkData.rgWishlist || [];
      
      const stillInWishlist = hostileGames.filter(g => currentWishlist.includes(parseInt(g.appid)));
      
      if (stillInWishlist.length > 0) {
        setHostileGames(stillInWishlist);
        toaster.toast({
          title: "Увага",
          body: `Вдалося видалити не все. Залишилося ${stillInWishlist.length} ігор.`,
          duration: 4000,
        });
      } else {
        setHostileGames([]);
        toaster.toast({
          title: "Успіх",
          body: "Ігри успішно видалено зі списку бажаного!",
          duration: 4000,
        });
      }
    } catch (e: any) {
      console.error("Failed to remove games", e);
      toaster.toast({
        title: "Помилка",
        body: "Не вдалося видалити: " + (e.message || String(e)),
        duration: 4000,
      });
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
