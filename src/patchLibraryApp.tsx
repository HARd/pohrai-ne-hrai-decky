import {
  afterPatch,
  appDetailsClasses,
  createReactTreePatcher,
  findInReactTree,
} from "@decky/ui";
import { routerHook } from "@decky/api";
import type { ReactElement } from "react";
import type { RouteProps } from "react-router";
import GamePageBadge from "./GamePageBadge";
import type { AppStatus, PluginSettings } from "./types";

type Lookup = (appid: string) => Promise<AppStatus>;
type SettingsGetter = () => PluginSettings;

export function patchLibraryApp(lookup: Lookup, getSettings: SettingsGetter) {
  return routerHook.addPatch("/library/app/:appid", (tree: RouteProps) => {
    const routeProps = findInReactTree(tree, (node: any) => node?.renderFunc);
    if (!routeProps) return tree;

    const patchHandler = createReactTreePatcher(
      [
        (node: any) =>
          findInReactTree(node, (child: any) => child?.props?.children?.props?.overview)
            ?.props?.children,
      ],
      (_: Array<Record<string, unknown>>, ret?: ReactElement) => {
        const container = findInReactTree(
          ret,
          (node: any) =>
            Array.isArray(node?.props?.children) &&
            String(node?.props?.className || "").includes(appDetailsClasses.InnerContainer),
        ) as any;

        if (!container || !Array.isArray(container.props?.children)) {
          return ret;
        }

        const alreadyInserted = container.props.children.some(
          (child: ReactElement) => child?.type === GamePageBadge,
        );
        if (!alreadyInserted) {
          container.props.children.splice(1, 0, <GamePageBadge lookup={lookup} getSettings={getSettings} />);
        }

        return ret;
      },
      "VartaLibraryPatch",
    );

    afterPatch(routeProps, "renderFunc", patchHandler);
    return tree;
  });
}
