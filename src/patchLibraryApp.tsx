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
import type { AppStatus } from "./types";

type Lookup = (appid: string) => Promise<AppStatus>;
export type RoutePatchHandle = {
  route: string;
  patch: ReturnType<typeof routerHook.addPatch>;
};

export function patchLibraryApp(lookup: Lookup) {
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
          container.props.children.splice(1, 0, <GamePageBadge lookup={lookup} />);
        }

        return ret;
      },
      "PohraiNeHraiLibraryPatch",
    );

    afterPatch(routeProps, "renderFunc", patchHandler);
    return tree;
  });
}

export function patchStoreApp(lookup: Lookup): RoutePatchHandle[] {
  const routes = [
    "/store/app/:appid",
    "/store/app/:appid/:slug",
    "/app/:appid",
    "/app/:appid/:slug",
  ];

  return routes.map((route) => ({
    route,
    patch: routerHook.addPatch(route, (tree: RouteProps) => {
      const routeProps = findInReactTree(tree, (node: any) => node?.renderFunc);
      if (!routeProps) return tree;

      afterPatch(routeProps, "renderFunc", (_: unknown[], ret?: ReactElement) => {
        if (!ret) return ret;
        return (
          <>
            {ret}
            <GamePageBadge lookup={lookup} placement="store" />
          </>
        );
      });

      return tree;
    }),
  }));
}
