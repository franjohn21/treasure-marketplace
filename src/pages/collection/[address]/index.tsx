import Router, { useRouter } from "next/router";
import React, { useEffect, useState } from "react";
import {
  ChevronRightIcon,
  HashtagIcon,
  InformationCircleIcon,
} from "@heroicons/react/solid";
import { useInfiniteQuery, useQueries, useQuery } from "react-query";
import {
  bridgeworld,
  client,
  marketplace,
  metadata,
  realm,
  smolverse,
} from "../../../lib/client";
import { CenterLoadingDots } from "../../../components/CenterLoadingDots";
import {
  abbreviatePrice,
  formatNumber,
  formatPercent,
  formatPrice,
  getCollectionNameFromSlug,
} from "../../../utils";
import { formatEther } from "ethers/lib/utils";
import ImageWrapper from "../../../components/ImageWrapper";
import Link from "next/link";
import { Modal } from "../../../components/Modal";
import {
  GetCollectionListingsQuery,
  Listing_OrderBy,
  OrderDirection,
  Status,
  TokenStandard,
} from "../../../../generated/marketplace.graphql";
import classNames from "clsx";
import { useInView } from "react-intersection-observer";
import { SearchAutocomplete } from "../../../components/SearchAutocomplete";
import { Item } from "react-stately";
import { Activity } from "../../../components/Activity";
import {
  useBattleflyMetadata,
  useCollection,
  useCollections,
  useFoundersMetadata,
  useGridSizeState,
  useSmithoniaWeaponsMetadata,
  useTalesOfElleriaRelicsMetadata,
} from "../../../lib/hooks";
import {
  EthIcon,
  MagicIcon,
  PercentIcon,
  SwapIcon,
} from "../../../components/Icons";
import { useMagic } from "../../../context/magicContext";
import {
  ALL_COLLECTION_METADATA,
  BridgeworldItems,
  COLLECTION_DESCRIPTIONS,
  METADATA_COLLECTIONS,
  smolverseItems,
} from "../../../const";
import * as Popover from "@radix-ui/react-popover";
import { normalizeBridgeworldTokenMetadata } from "../../../utils/metadata";
import {
  Filters,
  MobileFilterButton,
  MobileFiltersWrapper,
  useFiltersList,
} from "../../../components/Filters";
import { SortMenu } from "../../../components/SortMenu";
import { targetNftT } from "../../../types";
import { PurchaseItemModal } from "../../../components/PurchaseItemModal";
import { Metadata, MetadataProps } from "../../../components/Metadata";
import type { GetServerSidePropsContext } from "next";
import { useEthers } from "@usedapp/core";
import { GridSizeToggle } from "../../../components/GridToggle";
import { CollectionLinks } from "../../../components/CollectionLinks";
import useLocalStorage from "use-local-storage-state";
import { format } from "date-fns";

const MAX_ITEMS_PER_PAGE = 48;

const generateDescription = (collectionName: string) => {
  switch (collectionName) {
    case "Unpilgrimaged Legion Genesis":
    case "Unpilgrimaged Legion Auxiliary":
      return (
        <p className="text-gray-500 dark:text-gray-400 text-[0.5rem] sm:text-sm mt-4 sm:mt-6">
          Unpilgrimaged Legions need to undergo{" "}
          <a
            href="https://bridgeworld.treasure.lol/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Pilgrimage
          </a>{" "}
          to participate in Bridgeworld.
        </p>
      );
    default:
      return "";
  }
};

const tabs = [
  { name: "Collection", value: "collection" },
  { name: "Activity", value: "activity" },
];

const sortOptions = [
  {
    name: "Price: Low to High",
    value: Listing_OrderBy.pricePerItem,
    direction: OrderDirection.asc,
  },
  {
    name: "Price: High to Low",
    value: Listing_OrderBy.pricePerItem,
    direction: OrderDirection.desc,
  },
  {
    name: "Latest",
    value: Listing_OrderBy.blockTimestamp,
    direction: OrderDirection.desc,
  },
];

const NATURAL_RESOURCES = [
  "Ancient Artifacts",
  "Aquatic Resources",
  "Land Abundance",
  "Mineral Deposits",
];

function range(value: number, start: number) {
  return new Array(start - value)
    .fill("")
    .map((_, index) => index + value)
    .map(String);
}

function hasAttributeArray(
  value: unknown
): value is Array<{ attribute: Record<"name" | "value", string> }> {
  return (
    Array.isArray(value) &&
    "attribute" in value[0] &&
    typeof value[0].attribute === "object" &&
    "name" in value[0]?.attribute
  );
}

const formatSearchFilter = (search: string | undefined) => {
  if (!search) return [];

  const searchParams = Array.from(new URLSearchParams(search).entries());

  /*
    if searchParams is like this: [["Background", "red,blue"], ["Color", "green"]]
    return an array like this: ["Background,red", "Background,blue"]
  */
  return searchParams.reduce<string[]>((acc, [key, value]) => {
    return [...acc, ...value.split(",").map((v) => `${key},${v}`)];
  }, []);
};

// TODO: Remove this.
const getInititalFilters = (search: string | undefined) => {
  if (!search) return {};
  const searchParams = Array.from(new URLSearchParams(search).entries());

  /*
    if searchParams is like this: Background=alley
    return an object like this: {
      Background: ["alley"]
    }
    if searchParams is undefined, return an empty object
  */
  return searchParams.reduce<{ [key: string]: string[] }>(
    (acc, [key, value]) => {
      if (!acc[key]) {
        acc[key] = value.split(",");
        return acc;
      }
      acc[key] = [...acc[key], ...value.split(",")];
      return acc;
    },
    {}
  );
};

const unique = <T,>(array: T[]) => Array.from(new Set(array));

const Collection = ({ og }: { og: MetadataProps }) => {
  const router = useRouter();
  const { address: slugOrAddress, tab, search } = router.query;
  const formattedSearch = Array.isArray(search) ? search[0] : search;
  const [searchToken, setSearchToken] = useState("");
  const [searchParams, setSearchParams] = useState("");
  const [isDetailedFloorPriceModalOpen, setDetailedFloorPriceModalOpen] =
    useState(false);
  const [modalProps, setModalProps] = React.useState<{
    isOpen: boolean;
    targetNft: targetNftT | null;
  }>({
    isOpen: false,
    targetNft: null,
  });
  const [floorCurrency, setFloorCurrency] = useLocalStorage<"magic" | "eth">(
    "mp:floor-currency",
    { defaultValue: "magic" }
  );
  const [listedDisplay, setListedDisplay] = useLocalStorage<
    "number" | "percentage"
  >("mp:listed-display", { defaultValue: "number" });
  const [gridSize] = useGridSizeState();
  const filters = getInititalFilters(formattedSearch);
  const { ethPrice } = useMagic();
  const { account } = useEthers();

  const {
    id: formattedAddress,
    name: collectionName,
    slug,
  } = useCollection(slugOrAddress);
  const collections = useCollections();

  const formattedTab = tab ? (Array.isArray(tab) ? tab[0] : tab) : "collection";

  const isBridgeworldItem = BridgeworldItems.includes(collectionName);
  const isSmolverseItem = smolverseItems.includes(collectionName);
  const isTreasure = collectionName === "Treasures";
  const isShared = METADATA_COLLECTIONS.includes(collectionName);
  const isRealm = collectionName === "Realm";
  const isLegacy = [
    "Smol Bodies",
    "Smol Brains",
    "Smol Cars",
    "Seed of Life",
  ].includes(collectionName);
  const isBattleflyItem = collectionName === "BattleFly";
  const isFoundersItem = collectionName.includes("Founders");
  const isSmithonia = collectionName === "Smithonia Weapons";
  const isTalesOfElleriaRelics = collectionName === "Tales of Elleria Relics";

  // This is a faux collection with only recruits. Which are not sellable. Redirect to Legion Auxiliary collection.
  if (collectionName === "Legions") {
    router.replace("/collection/legion-auxiliary");
  }

  const closePurchaseModal = React.useCallback(
    () => setModalProps({ isOpen: false, targetNft: null }),
    []
  );

  const attributeFilterList = useFiltersList();

  const { data: statData } = useQuery(
    ["stats", formattedAddress],
    () =>
      marketplace.getCollectionStats({
        id: formattedAddress,
      }),
    {
      enabled: !!formattedAddress,
    }
  );

  React.useEffect(() => {
    const scrollToTop = () => {
      document.getElementById("filter-heading")?.scrollIntoView();
    };
    Router.events.on("routeChangeComplete", scrollToTop);

    return () => Router.events.off("routeChangeComplete", scrollToTop);
  }, []);

  const isERC1155 = statData?.collection?.standard === TokenStandard.ERC1155;

  // First get all possible listed tokens
  const listedTokens = useQuery(
    ["listed-tokens", formattedAddress],
    () =>
      marketplace.getCollectionsListedTokens({ collection: formattedAddress }),
    {
      enabled: !!formattedAddress,
      select: React.useCallback(
        (
          data: Awaited<
            ReturnType<typeof marketplace.getCollectionsListedTokens>
          >
        ) => unique(data.listings.map(({ token }) => token.id)),
        []
      ),
    }
  );

  // Use listed tokenIds to retrieve any filters
  const attributeIds = React.useMemo(
    () =>
      formatSearchFilter(formattedSearch).map(
        (filter) =>
          `${formattedAddress}-${filter.toLowerCase().replace(",", "-")}`
      ),
    [formattedAddress, formattedSearch]
  );
  const filteredCarsTokens = useQuery(
    ["cars-filtered-tokens", listedTokens.data, attributeIds],
    () =>
      client.getFilteredTokens({
        attributeIds,
        tokenIds: listedTokens.data ?? [],
      }),
    {
      enabled:
        Boolean(listedTokens.data) && attributeIds.length > 0 && isLegacy,
      select: React.useCallback(
        ({
          metadataAttributes,
        }: Awaited<ReturnType<typeof client.getFilteredTokens>>) => {
          const sections = metadataAttributes.reduce<Record<string, string[]>>(
            (acc, { id }) => {
              const [, token, collection, key] = id.split("-");

              acc[key] ??= [];
              acc[key] = [...acc[key], `${collection}-${token}`];

              return acc;
            },
            {}
          );

          return Object.keys(sections).reduce((acc, key) => {
            const items = sections[key];

            return acc.length > 0
              ? acc.filter((item) => items.includes(item))
              : items;
          }, []);
        },
        []
      ),
    }
  );
  const filteredBridgeworldTokens = useQuery(
    ["bw-filtered-tokens", listedTokens.data, filters],
    () => {
      const keys = Object.keys(filters);
      const isConstellation = keys.some((key) =>
        key.startsWith("Constellation: ")
      );
      const isLegionInfo =
        keys.filter((key) => !key.startsWith("Constellation: ")).length > 0;

      return bridgeworld.getFilteredLegions({
        constellation: {
          id_in: isConstellation ? listedTokens.data : [],
          ...Object.entries(filters).reduce((acc, [key, value]) => {
            switch (key) {
              case "Constellation: Dark":
              case "Constellation: Earth":
              case "Constellation: Fire":
              case "Constellation: Light":
              case "Constellation: Water":
              case "Constellation: Wind":
                acc[`${key.toLowerCase().replace("constellation: ", "")}_gte`] =
                  Number(value[0].replace(/[^\d]+/, ""));

                break;
              default:
                break;
            }

            return acc;
          }, {}),
        },
        legionInfo: {
          id_in: isLegionInfo
            ? listedTokens.data?.map((id) => `${id}-metadata`)
            : [],
          ...Object.entries(filters).reduce((acc, [key, value]) => {
            switch (key) {
              case "Summon Fatigue":
                acc[value[0] === "Yes" ? "cooldown_not" : "cooldown"] = null;

                break;
              case "Times Summoned":
                acc["summons_in"] = value;

                break;
              case "Atlas Mine Boost":
                acc["boost_in"] = value.map((choice) =>
                  (Number(choice.replace("%", "")) / 100).toString()
                );

                break;
              case "Constellation: Dark":
              case "Constellation: Earth":
              case "Constellation: Fire":
              case "Constellation: Light":
              case "Constellation: Water":
              case "Constellation: Wind":
                break;
              case "Crafting Level":
              case "Crafting XP":
              case "Questing Level":
              case "Questing XP":
                acc[
                  `${key
                    .toLowerCase()
                    .replace(" xp", "Xp")
                    .replace(" level", "")}_gte`
                ] = Number(value[0].replace(/[^\d]+/, ""));

                break;
              default:
                acc[`${key.toLowerCase()}_in`] = value;
            }

            return acc;
          }, {}),
        },
      });
    },
    {
      enabled:
        Boolean(listedTokens.data) &&
        Object.keys(filters).length > 0 &&
        isBridgeworldItem,
      select: React.useCallback(
        (data: Awaited<ReturnType<typeof bridgeworld.getFilteredLegions>>) => {
          const constellations = data.constellations.map((item) => item.id);
          const legionInfos = data.legionInfos.map((item) =>
            item.id.replace("-metadata", "")
          );

          if (constellations.length > 0 && legionInfos.length > 0) {
            return constellations.filter((id) => legionInfos.includes(id));
          }

          return [...constellations, ...legionInfos];
        },
        []
      ),
    }
  );
  const filteredTreasureTokens = useQuery(
    ["treasure-filtered-tokens", listedTokens.data, filters],
    () =>
      bridgeworld.getFilteredTreasures({
        filters: {
          id_in: listedTokens.data?.map((id) => `${id}-metadata`),
          ...Object.entries(filters).reduce((acc, [key, value]) => {
            switch (key) {
              case "Atlas Mine Boost":
                acc["boost_in"] = value.map((choice) =>
                  (Number(choice.replace("%", "")) / 100).toString()
                );

                break;
              default:
                acc[`${key.toLowerCase()}_in`] = value.map((item) =>
                  key === "Tier" ? Number(item) : item
                );
            }

            return acc;
          }, {}),
        },
      }),
    {
      enabled:
        Boolean(listedTokens.data) &&
        Object.keys(filters).length > 0 &&
        isTreasure,
      select: React.useCallback(
        (data: Awaited<ReturnType<typeof bridgeworld.getFilteredTreasures>>) =>
          data.treasureInfos.map((item) => item.id.replace("-metadata", "")),
        []
      ),
    }
  );
  const filteredBattleflyTokens = useQuery(
    ["bf-filtered-tokens", listedTokens.data, filters],
    () =>
      fetch(
        `${
          process.env.NEXT_PUBLIC_BATTLEFLY_API
        }/battleflies/ids?${formattedSearch
          ?.split("&")
          .map((filters) =>
            filters.split("=").reduce(
              (field, values) =>
                field
                  ? `${field}=${values
                      .split("%2C")
                      .map((value, index) =>
                        index > 0 ? `${field}=${value}` : value
                      )
                      .join("&")}`
                  : values.slice(0, 1).toLowerCase().concat(values.slice(1)),
              ""
            )
          )
          .join("&")}`
      ).then((res) => res.json()),
    {
      enabled:
        Boolean(listedTokens.data) &&
        Object.keys(filters).length > 0 &&
        isBattleflyItem,
      refetchInterval: false,
      select: React.useCallback(
        (data: { items: number[] }) => {
          const hexxed = data.items.map((id) => `0x${id.toString(16)}`);

          return listedTokens.data?.filter((id) =>
            hexxed.some((hex) => id.endsWith(hex))
          );
        },
        [listedTokens.data]
      ),
    }
  );
  const filteredSmithoniaWeaponsTokens = useQuery(
    ["sw-filtered-tokens", listedTokens.data, filters],
    () =>
      fetch(
        `${process.env.NEXT_PUBLIC_SMITHONIA_WEAPONS_API}/ids?${formattedSearch
          ?.split("&")
          .map((filters) =>
            filters.split("=").reduce(
              (field, values) =>
                field
                  ? `${field}=${values
                      .split("%2C")
                      .map((value, index) =>
                        index > 0 ? `${field}=${value}` : value
                      )
                      .join("&")}`
                  : values.slice(0, 1).toLowerCase().concat(values.slice(1)),
              ""
            )
          )
          .join("&")}`
      ).then((res) => res.json()),
    {
      enabled:
        Boolean(listedTokens.data) &&
        Object.keys(filters).length > 0 &&
        isSmithonia,
      refetchInterval: false,
      select: React.useCallback(
        (data) => {
          const itemsToHex = (items: number[]): string[] => {
            const hexxed = items.map((id) => `0x${id.toString(16)}`);
            return (
              listedTokens.data?.filter((id) =>
                hexxed.some((hex) => id.endsWith(hex))
              ) ?? []
            );
          };

          if (Array.isArray(data)) {
            return data.map((dataItem) => itemsToHex(dataItem.items)).flat();
          } else {
            return itemsToHex(data.items);
          }
        },
        [listedTokens.data]
      ),
    }
  );
  const filteredTalesOfElleriaRelicsTokens = useQuery(
    ["toe-relics-filtered-tokens", listedTokens.data, filters],
    () =>
      fetch(
        `${
          process.env.NEXT_PUBLIC_TALES_OF_ELLERIA_RELICS_API
        }/api/relics?${formattedSearch
          ?.split("&")
          .map((filters) =>
            filters.split("=").reduce(
              (field, values) =>
                field
                  ? values
                      .split("%2C")
                      .map((value) => `${field}=${value}`)
                      .join("&")
                  : values.slice(0, 1).concat(values.slice(1)),
              ""
            )
          )
          .join("&")}`
      ).then((res) => res.json()),
    {
      enabled:
        Boolean(listedTokens.data) &&
        Object.keys(filters).length > 0 &&
        isTalesOfElleriaRelics,
      refetchInterval: false,
      select: React.useCallback(
        (data: Array<{ id: number }>) => {
          const hexxed = data.map(({ id }) => `0x${id.toString(16)}`);

          return listedTokens.data?.filter((id) =>
            hexxed.some((hex) => id.endsWith(hex))
          );
        },
        [listedTokens.data]
      ),
    }
  );
  const filteredSharedTokensQueries = useQueries({
    queries: Object.entries(filters).map(([name, value]) => ({
      queryKey: ["shared-filtered-tokens", listedTokens.data, name, value],
      queryFn: () => {
        const onlyNumbers = value[0].replace(/^(>|=|<|\s)*(\d+)$/, "$2");
        const isNumber =
          onlyNumbers !== value[0] || !Number.isNaN(Number(value[0]));
        const number = Number(onlyNumbers);
        const filter = {
          value_in: isNumber ? range(number, number <= 100 ? 101 : 446) : value,
        };

        return metadata.getFilteredTokens({
          filter: { name, ...filter },
          tokenIds: listedTokens.data ?? [],
        });
      },
      enabled:
        Boolean(listedTokens.data) &&
        Object.keys(filters).length > 0 &&
        isShared,
    })),
  }).filter((query) => query.status !== "loading");
  const filteredSharedTokens = React.useMemo(() => {
    if (filteredSharedTokensQueries.length === 0) {
      return { data: undefined };
    }

    const data = filteredSharedTokensQueries
      .map(
        ({ data }) =>
          data?.attributes.flatMap((attribute) =>
            attribute.tokens.map((token) => token.id)
          ) ?? []
      )
      .filter((item): item is string[] => item.length > 0);

    return {
      data:
        data.length > 0
          ? data.reduce((acc, result) =>
              acc.filter((item) => result.includes(item))
            )
          : [],
    };
  }, [filteredSharedTokensQueries]);
  const filteredSmolverseTokensQueries = useQueries({
    queries: Object.entries(filters).map(([name, value]) => ({
      queryKey: ["smolverse-filtered-tokens", listedTokens.data, name, value],
      queryFn: () => {
        const onlyNumbers = value[0].replace(/^(>|=|<|\s)*(\d+)$/, "$2");
        const isNumber =
          onlyNumbers !== value[0] || !Number.isNaN(Number(value[0]));
        const number = Number(onlyNumbers);
        const filter = {
          value_in: isNumber ? range(number, number <= 100 ? 101 : 446) : value,
        };

        return smolverse.getFilteredTokens({
          filter: { name, ...filter },
          tokenIds: listedTokens.data ?? [],
        });
      },
      enabled:
        Boolean(listedTokens.data) &&
        Object.keys(filters).length > 0 &&
        isSmolverseItem,
    })),
  }).filter((query) => query.status !== "loading");
  const filteredSmolverseTokens = React.useMemo(() => {
    if (filteredSmolverseTokensQueries.length === 0) {
      return { data: undefined };
    }

    const data = filteredSmolverseTokensQueries
      .map(
        ({ data }) =>
          data?.attributes.flatMap((attribute) =>
            attribute.tokens.map((token) => token.id)
          ) ?? []
      )
      .filter((item): item is string[] => item.length > 0);

    return {
      data:
        data.length > 0
          ? data.reduce((acc, result) =>
              acc.filter((item) => result.includes(item))
            )
          : [],
    };
  }, [filteredSmolverseTokensQueries]);
  const filteredRealmResourceTokens = useQuery(
    ["realm-filtered-resource-tokens", listedTokens.data, filters],
    () =>
      realm.getFilteredNaturalResources({
        filters: {
          id_in: listedTokens.data?.map(
            (id) => `${parseInt(id.slice(45), 16)}`
          ),
          ...Object.entries(filters).reduce((acc, [key, value]) => {
            if (!NATURAL_RESOURCES.includes(key)) {
              return acc;
            }

            const filterKey = key[0]
              .toLowerCase()
              .concat(key.slice(1).replace(" ", ""))
              .replace("Deposits", "Deposit");

            acc[`${filterKey}_gte`] = value[0];
            acc[`${filterKey}_lte`] = value[1];

            return acc;
          }, {}),
        },
      }),
    {
      enabled:
        Boolean(listedTokens.data) &&
        Object.keys(filters).some((key) => NATURAL_RESOURCES.includes(key)) &&
        isRealm,
      select: React.useCallback(
        (data: Awaited<ReturnType<typeof realm.getFilteredNaturalResources>>) =>
          data.totalNaturalResources.map(
            (item) => `${formattedAddress}-0x${Number(item.id).toString(16)}`
          ),
        [formattedAddress]
      ),
    }
  );
  const filteredRealmStructureTokens = useQuery(
    ["realm-filtered-structure-tokens", listedTokens.data, filters],
    () =>
      realm.getFilteredStructures({
        filters: {
          realm_in: listedTokens.data?.map(
            (id) => `${parseInt(id.slice(45), 16)}`
          ),
          ...Object.entries(filters).reduce((acc, [key, value]) => {
            if (key !== "Reactor") {
              return acc;
            }

            acc["type"] = "Reactor";
            acc["staked"] = value[0] === "Yes";

            return acc;
          }, {}),
        },
      }),
    {
      enabled:
        Boolean(listedTokens.data) &&
        Object.keys(filters).some((key) => key === "Reactor") &&
        isRealm,
      select: React.useCallback(
        (data: Awaited<ReturnType<typeof realm.getFilteredStructures>>) =>
          data.structures.map(
            (item) =>
              `${formattedAddress}-0x${Number(item.realm?.id).toString(16)}`
          ),
        [formattedAddress]
      ),
    }
  );
  const filteredRealmRefineriesTokens = useQuery(
    ["realm-filtered-refinery-tokens", listedTokens.data, filters],
    () =>
      realm.getFilteredMagicRefineries({
        filters: {
          realm_in: listedTokens.data?.map(
            (id) => `${parseInt(id.slice(45), 16)}`
          ),
          ...Object.entries(filters).reduce((acc, [key, value]) => {
            if (key !== "Magic Refinery") {
              return acc;
            }

            acc["staked"] = true;
            acc["tier_in"] = value.map((item) => item.slice(-1));

            return acc;
          }, {}),
        },
      }),
    {
      enabled:
        Boolean(listedTokens.data) &&
        Object.keys(filters).some((key) => key === "Magic Refinery") &&
        isRealm,
      select: React.useCallback(
        (data: Awaited<ReturnType<typeof realm.getFilteredMagicRefineries>>) =>
          data.magicRefineries.map(
            (item) =>
              `${formattedAddress}-0x${Number(item.realm?.id).toString(16)}`
          ),
        [formattedAddress]
      ),
    }
  );
  const filteredRealmFeaturesTokens = useQuery(
    ["realm-filtered-features-tokens", listedTokens.data, filters],
    () =>
      realm.getFilteredFeatures({
        ids:
          listedTokens.data?.map((id) => `${parseInt(id.slice(45), 16)}`) ?? [],
        feature: filters.Features,
      }),
    {
      enabled:
        Boolean(listedTokens.data) &&
        (filters.Features?.length ?? 0) > 0 &&
        isRealm,
      select: React.useCallback(
        ({
          feature1,
          feature2,
          feature3,
        }: Awaited<ReturnType<typeof realm.getFilteredFeatures>>) =>
          [...feature1, ...feature2, ...feature3].map(
            (item) => `${formattedAddress}-0x${Number(item.id).toString(16)}`
          ),
        [formattedAddress]
      ),
    }
  );
  const filteredRealmTokens = React.useMemo(
    () => ({
      data:
        isRealm &&
        Object.keys(filters).length > 0 &&
        [
          filteredRealmRefineriesTokens.status,
          filteredRealmResourceTokens.status,
          filteredRealmStructureTokens.status,
          filteredRealmFeaturesTokens.status,
        ].some((status) => status === "success")
          ? unique([
              ...(filteredRealmRefineriesTokens.data ?? []),
              ...(filteredRealmResourceTokens.data ?? []),
              ...(filteredRealmStructureTokens.data ?? []),
              ...(filteredRealmFeaturesTokens.data ?? []),
            ])
          : undefined,
    }),
    [
      isRealm,
      filters,
      filteredRealmRefineriesTokens.status,
      filteredRealmRefineriesTokens.data,
      filteredRealmResourceTokens.status,
      filteredRealmResourceTokens.data,
      filteredRealmStructureTokens.status,
      filteredRealmStructureTokens.data,
      filteredRealmFeaturesTokens.status,
      filteredRealmFeaturesTokens.data,
    ]
  );

  // Use filtered or listed tokenIds to perform text search
  const searchedTokens = useQuery(
    [
      "searched-token",
      filteredBattleflyTokens.data,
      filteredSmithoniaWeaponsTokens.data,
      filteredTalesOfElleriaRelicsTokens.data,
      filteredSharedTokens.data,
      filteredRealmTokens.data,
      filteredTreasureTokens.data,
      filteredBridgeworldTokens.data,
      filteredSmolverseTokens.data,
      filteredCarsTokens.data,
      listedTokens.data,
      searchParams,
    ],
    () => {
      const lower = searchParams.toLowerCase();
      const start = lower[0].toUpperCase().concat(lower.slice(1));

      return marketplace.getTokensByName({
        lower,
        start,
        ids:
          filteredBattleflyTokens.data ??
          filteredSmithoniaWeaponsTokens.data ??
          filteredTalesOfElleriaRelicsTokens.data ??
          filteredSharedTokens.data ??
          filteredRealmTokens.data ??
          filteredTreasureTokens.data ??
          filteredBridgeworldTokens.data ??
          filteredSmolverseTokens.data ??
          filteredCarsTokens.data ??
          listedTokens.data ??
          [],
      });
    },
    {
      enabled: Boolean(listedTokens.data) && Boolean(searchParams),
      refetchInterval: false,
      select: React.useCallback(
        (data: Awaited<ReturnType<typeof marketplace.getTokensByName>>) =>
          unique([
            ...data.lower.map((token) => token.id),
            ...data.start.map((token) => token.id),
          ]),
        []
      ),
    }
  );
  const [erc721Ordering, orderDirection] = (
    typeof router.query.sort === "string"
      ? router.query.sort.split(":")
      : [sortOptions[0].value, sortOptions[0].direction]
  ) as [Listing_OrderBy, OrderDirection];

  // Use final list of tokens to paginate listings
  const tokenIds = React.useMemo(
    () =>
      searchedTokens.data ??
      filteredBattleflyTokens.data ??
      filteredSmithoniaWeaponsTokens.data ??
      filteredTalesOfElleriaRelicsTokens.data ??
      filteredSharedTokens.data ??
      filteredRealmTokens.data ??
      filteredTreasureTokens.data ??
      filteredBridgeworldTokens.data ??
      filteredSmolverseTokens.data ??
      filteredCarsTokens.data ??
      listedTokens.data,
    [
      searchedTokens.data,
      filteredBattleflyTokens.data,
      filteredSmithoniaWeaponsTokens.data,
      filteredTalesOfElleriaRelicsTokens.data,
      filteredSharedTokens.data,
      filteredRealmTokens.data,
      filteredTreasureTokens.data,
      filteredBridgeworldTokens.data,
      filteredSmolverseTokens.data,
      filteredCarsTokens.data,
      listedTokens.data,
    ]
  );
  const listings = useInfiniteQuery(
    ["listings", isERC1155, erc721Ordering, orderDirection, tokenIds],
    ({ pageParam = 0 }) =>
      marketplace.getCollectionListings({
        erc1155Filters: {
          id_in: tokenIds,
        },
        erc721Filters: {
          status: Status.Active,
          token_in: tokenIds,
        },
        erc721Ordering,
        isERC1155,
        orderDirection,
        skip: pageParam,
      }),
    {
      enabled: !!tokenIds,
      getNextPageParam: (last, pages) =>
        last.listings?.length === MAX_ITEMS_PER_PAGE
          ? pages.length * MAX_ITEMS_PER_PAGE
          : undefined,
      keepPreviousData: true,
      refetchInterval: false,
    }
  );

  const listingIds = React.useMemo(
    () =>
      listings.data?.pages
        .map(
          (page) =>
            page.listings?.map((listing) => listing.token.id) ??
            page.tokens?.map((token) => token.id) ??
            []
        )
        .flat() ?? [],
    [listings.data?.pages]
  );

  const legacyMetadata = useQuery(
    ["metadata", listingIds],
    () => client.getCollectionMetadata({ ids: listingIds }),
    {
      enabled: listingIds.length > 0 && isLegacy,
      refetchInterval: false,
      keepPreviousData: true,
    }
  );

  const bridgeworldMetadata = useQuery(
    ["bw-metadata", listingIds],
    () => bridgeworld.getBridgeworldMetadata({ ids: listingIds }),
    {
      enabled: listingIds.length > 0 && (isBridgeworldItem || isTreasure),
      refetchInterval: false,
      keepPreviousData: true,
    }
  );

  const smolverseMetadata = useQuery(
    ["sv-metadata", listingIds],
    () => smolverse.getSmolverseMetadata({ ids: listingIds }),
    {
      enabled: listingIds.length > 0 && isSmolverseItem,
      refetchInterval: false,
      keepPreviousData: true,
    }
  );

  const sharedMetadata = useQuery(
    ["shared-metadata", listingIds],
    () => metadata.getTokenMetadata({ ids: listingIds }),
    {
      enabled: listingIds.length > 0 && isShared,
      refetchInterval: false,
      keepPreviousData: true,
    }
  );

  const realmMetadata = useQuery(
    ["realm-metadata", listingIds],
    () =>
      realm.getRealmMetadata({
        ids: listingIds.map((item) => `${parseInt(item.slice(45), 16)}`),
      }),
    {
      enabled: listingIds.length > 0 && isRealm,
      refetchInterval: false,
      keepPreviousData: true,
    }
  );

  const battleflyMetadata = useBattleflyMetadata(
    isBattleflyItem ? listingIds : []
  );
  const foundersMetadata = useFoundersMetadata(
    isFoundersItem ? listingIds : []
  );
  const smithoniaMetadata = useSmithoniaWeaponsMetadata(
    isSmithonia ? listingIds : []
  );
  const talesOfElleriaRelicsMetadata = useTalesOfElleriaRelicsMetadata(
    isTalesOfElleriaRelics ? listingIds : []
  );

  const tokensWithStats = isTalesOfElleriaRelics
    ? listings.data?.pages[0].tokens?.map((token) => {
        const metadata = talesOfElleriaRelicsMetadata.data?.find(
          (item) => parseInt(item.id) === parseInt(token.tokenId)
        );
        return {
          ...token,
          name: metadata?.name,
        };
      })
    : isShared
    ? listings.data?.pages[0].tokens?.map((token) => {
        const metadata = sharedMetadata.data?.tokens.find(
          (item) => item.tokenId === token.tokenId
        );
        return {
          ...token,
          name: metadata?.name,
        };
      })
    : listings.data?.pages[0].tokens;

  const isLoading = React.useMemo(
    () =>
      [
        listings.status,
        legacyMetadata.status,
        bridgeworldMetadata.status,
        smolverseMetadata.status,
        sharedMetadata.status,
        realmMetadata.status,
        battleflyMetadata.status,
        foundersMetadata.status,
      ].every((status) => ["idle", "loading"].includes(status)),
    [
      listings.status,
      legacyMetadata.status,
      sharedMetadata.status,
      bridgeworldMetadata.status,
      realmMetadata.status,
      smolverseMetadata.status,
      battleflyMetadata.status,
      foundersMetadata.status,
    ]
  );

  // reset searchParams on address change
  useEffect(() => {
    setSearchParams("");
    setSearchToken("");
  }, [formattedAddress]);

  const { ref, inView } = useInView({
    threshold: 0,
  });

  useEffect(() => {
    if (inView) {
      listings.fetchNextPage();
    }
  }, [listings, inView]);

  const description = COLLECTION_DESCRIPTIONS[slug] ?? null;
  const info = ALL_COLLECTION_METADATA.find((item) => item.href === slug);
  const related = info?.related
    ?.map((related) =>
      ALL_COLLECTION_METADATA.find((item) => item.href === related)
    )
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) =>
      collections.some((collection) => collection.slug === item.href)
    );

  return (
    <div>
      <MobileFiltersWrapper />
      <Metadata {...og} />
      <div className="mx-auto px-4 sm:px-6 lg:px-8 pt-24">
        <div className="py-16 flex flex-col items-center">
          {statData?.collection ? (
            <>
              <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
                {collectionName}
              </h1>
              <div className="mt-10 md:mt-12 overflow-hidden relative">
                <dl className="-mx-4 -mt-4 md:-mt-8 grid grid-cols-2 md:grid-cols-4 divide-y-2 divide-x-2 md:divide-y-0 dark:divide-gray-800 text-center md:text-left">
                  <div className="flex flex-col px-6 sm:px-8 py-4 md:pb-0 md:pt-8">
                    <dt className="order-2 font-medium text-sm md:text-base text-gray-500 dark:text-gray-400 mt-4 flex justify-center md:justify-start">
                      <span className="capsize">Floor Price</span>
                      <button
                        className="inline-flex self-end items-center ml-2"
                        onClick={() =>
                          setFloorCurrency((currency) =>
                            currency === "eth" ? "magic" : "eth"
                          )
                        }
                      >
                        <SwapIcon className="h-4 w-4" />
                        {floorCurrency === "eth" ? (
                          <MagicIcon className="h-4 w-4" />
                        ) : (
                          <EthIcon className="h-4 w-4" />
                        )}
                      </button>
                    </dt>
                    <dd className="order-1 font-extrabold text-red-600 dark:text-gray-200 text-2xl md:text-3xl flex justify-center md:justify-start">
                      {floorCurrency === "eth" ? (
                        <EthIcon className="h-4 w-4 self-end mr-2" />
                      ) : (
                        <MagicIcon className="h-4 w-4 self-end mr-2" />
                      )}
                      <span className="capsize">
                        {floorCurrency === "eth"
                          ? formatNumber(
                              Number(
                                parseFloat(
                                  formatEther(
                                    statData.collection.stats.floorPrice
                                  )
                                )
                              ) * parseFloat(ethPrice)
                            )
                          : formatPrice(
                              statData.collection.stats.floorPrice
                            )}{" "}
                      </span>
                    </dd>
                    {isERC1155 &&
                      (listings.data?.pages?.[0].tokens?.length ?? 0) > 12 && (
                        <button
                          className="order-3 text-xs block underline hover:no-underline place-self-start mt-2 dark:text-gray-300 flex items-center justify-center"
                          onClick={() => setDetailedFloorPriceModalOpen(true)}
                        >
                          Compare floor prices
                          <ChevronRightIcon className="w-4 h-4" />
                        </button>
                      )}
                  </div>
                  <div className="flex flex-col px-6 sm:px-8 py-4 md:pb-0 md:pt-8">
                    <dt className="order-2 text-sm md:text-base font-medium text-gray-500 dark:text-gray-400 mt-4 flex justify-center md:justify-start">
                      <span className="capsize">Listed</span>
                      <button
                        className="inline-flex self-end items-center ml-2"
                        onClick={() =>
                          setListedDisplay((display) =>
                            display === "number" ? "percentage" : "number"
                          )
                        }
                      >
                        <SwapIcon className="h-4 w-4" />
                        {listedDisplay === "number" ? (
                          <PercentIcon className="h-4 w-4" />
                        ) : (
                          <HashtagIcon className="h-4 w-4" />
                        )}
                      </button>
                    </dt>
                    <dd className="order-1 font-extrabold text-red-600 dark:text-gray-200 text-2xl md:text-3xl capsize">
                      {listedDisplay === "number"
                        ? formatNumber(statData.collection.stats.listings)
                        : formatPercent(
                            statData.collection.stats.listings /
                              statData.collection.stats.items
                          )}
                    </dd>
                  </div>
                  <div
                    aria-hidden="true"
                    className="md:hidden absolute top-[calc(50%-1.5rem)] left-[calc(50%-1rem)] !border-0 bg-white dark:bg-gray-900 h-8 w-8"
                  />
                  <div className="flex flex-col px-6 sm:px-8 py-4 md:pb-0 md:pt-8 -ml-1 md:ml-0">
                    <dt className="order-2 text-sm md:text-base font-medium text-gray-500 dark:text-gray-400 mt-4">
                      Volume ($MAGIC)
                    </dt>
                    <dd className="order-1 font-extrabold text-red-600 dark:text-gray-200 text-2xl md:text-3xl capsize">
                      {abbreviatePrice(statData.collection.stats.volume)}
                    </dd>
                  </div>
                  <div className="flex flex-col px-6 sm:px-8 py-4 md:pb-0 md:pt-8">
                    <dt className="order-2 text-sm md:text-base font-medium text-gray-500 dark:text-gray-400 mt-4">
                      Items
                    </dt>
                    <dd className="order-1 font-extrabold text-red-600 dark:text-gray-200 text-2xl md:text-3xl capsize">
                      {abbreviatePrice(statData.collection.stats.items)}
                    </dd>
                  </div>
                </dl>
              </div>
              {description ? (
                <p className="mt-8 text-sm md:text-base lg:text-xl text-gray-500 text-center max-w-lg lg:max-w-4xl">
                  {description}
                </p>
              ) : null}
              {generateDescription(collectionName)}
              <div className="mt-12 flex">
                <CollectionLinks />
              </div>
              {related && related.length > 0 ? (
                <div className="mt-12 flex flex-col md:flex-row items-center text-gray-600">
                  Related:
                  {related.map((item, index, array) => (
                    <Link
                      key={item.href}
                      href={`/collection/${item.href}`}
                      passHref
                    >
                      <a
                        className={classNames(
                          "relative w-full md:w-auto px-4 py-2 text-center border border-gray-300 bg-white dark:bg-transparent text-sm font-medium text-gray-500 dark:text-gray-200 hover:bg-gray-50 focus:z-10 focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 dark:focus:ring-gray-500 dark:focus:border-gray-500",
                          index === 0
                            ? "mt-2 md:mt-0 md:ml-2 md:border-l border-t rounded-t-md md:rounded-t-none md:!rounded-l-md"
                            : "border-t-0 md:border-t md:border-l-0",
                          index === array.length - 1
                            ? "rounded-b-md md:!rounded-r-md md:rounded-b-none"
                            : undefined
                        )}
                      >
                        {item.name}
                      </a>
                    </Link>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="animate-pulse w-56 bg-gray-300 h-12 rounded-md m-auto" />
          )}
        </div>
        <div>
          <div className="block" id="filter-heading">
            <div className="border-b border-gray-200 dark:border-gray-500">
              <nav
                className="-mb-px flex justify-center space-x-8"
                aria-label="Tabs"
              >
                {tabs.map((tab) => {
                  const isCurrentTab = formattedTab === tab.name.toLowerCase();
                  return (
                    <Link
                      key={tab.name}
                      href={{
                        pathname: router.pathname,
                        query: {
                          ...router.query,
                          tab: tab.value,
                        },
                      }}
                      passHref
                    >
                      <a
                        className={classNames(
                          isCurrentTab
                            ? "border-red-500 text-red-600 dark:border-gray-300 dark:text-gray-300"
                            : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:hover:border-gray-500",
                          "whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm"
                        )}
                        aria-current={isCurrentTab ? "page" : undefined}
                      >
                        {tab.name}
                      </a>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>
        {formattedTab === "collection" ? (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-x-8 gap-y-10">
            <div className="hidden lg:block sticky top-6">
              <Filters />
            </div>
            <div
              className={classNames(
                attributeFilterList ? "lg:col-span-3" : "lg:col-span-4"
              )}
            >
              <section aria-labelledby="filter-heading" className="pt-6">
                <h2 id="filter-heading" className="sr-only">
                  Product search
                </h2>

                {statData?.collection && (
                  <div className="flex items-center">
                    <div className="mr-2 w-full">
                      <input
                        type="text"
                        className="form-input focus:ring-red-500 focus:border-red-500 dark:focus:ring-gray-300 dark:focus:border-gray-300 block w-full pr-16 sm:text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:disabled:bg-gray-500 dark:placeholder-gray-400 rounded-md disabled:placeholder-gray-300 disabled:text-gray-300 transition-placeholder transition-text ease-linear duration-300 disabled:cursor-not-allowed"
                        placeholder="Search Name... (Enter to search)"
                        value={searchToken}
                        onChange={(e) => setSearchToken(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setSearchParams(searchToken);
                          }
                        }}
                      />
                    </div>
                    <SortMenu
                      mobileFilterButtonSlot={<MobileFilterButton />}
                      options={sortOptions.slice(
                        0,
                        isERC1155 ? -1 : sortOptions.length
                      )}
                    />
                    {attributeFilterList && <GridSizeToggle />}
                  </div>
                )}
              </section>
              {isLoading ? (
                <CenterLoadingDots className="h-60" />
              ) : tokenIds?.length === 0 ? (
                <div className="flex flex-col justify-center items-center h-36">
                  <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-200">
                    No NFTs listed 😞
                  </h3>
                </div>
              ) : null}
              {!isLoading ? (
                <section aria-labelledby="products-heading" className="my-8">
                  <h2 id="products-heading" className="sr-only">
                    {collectionName}
                  </h2>
                  <ul
                    role="list"
                    className={classNames(
                      `grid grid-cols-2 gap-y-10 sm:grid-cols-4 2xl:grid-cols-${
                        gridSize ? 6 : 4
                      } gap-x-6 xl:gap-x-8`,
                      {
                        "2xl:grid-cols-4": attributeFilterList,
                        "2xl:grid-cols-6": !attributeFilterList,
                      }
                    )}
                  >
                    {listings.data?.pages.map((group, i) => (
                      <React.Fragment key={i}>
                        {/* ERC1155 */}
                        {group.tokens
                          ?.filter((token) => token.stats?.listings)
                          .map((token) => {
                            const erc1155Metadata =
                              legacyMetadata.data?.tokens?.find(
                                (metadata) => metadata.tokenId === token.tokenId
                              );

                            const legionsMetadata =
                              bridgeworldMetadata.data?.tokens.find(
                                (item) => item.id === token.id
                              );

                            const svMetadata =
                              smolverseMetadata.data?.tokens.find(
                                (item) => item.id === token.id
                              );

                            const shrdMetadata = isShared
                              ? sharedMetadata.data?.tokens.find(
                                  (item) => item.id === token.id
                                )
                              : null;

                            const toeRelicsMetadata = isTalesOfElleriaRelics
                              ? talesOfElleriaRelicsMetadata.data?.find(
                                  (item) =>
                                    parseInt(item.id) ===
                                    parseInt(token.tokenId)
                                )
                              : null;

                            const metadata =
                              (isBridgeworldItem || isTreasure) &&
                              legionsMetadata
                                ? {
                                    id: legionsMetadata.id,
                                    name: legionsMetadata.name,
                                    tokenId: token.tokenId,
                                    metadata: {
                                      image: legionsMetadata.image,
                                      name: legionsMetadata.name,
                                      description: "Consumables",
                                    },
                                  }
                                : isSmolverseItem && svMetadata
                                ? {
                                    id: svMetadata.id,
                                    name: svMetadata.name,
                                    tokenId: token.tokenId,
                                    metadata: {
                                      image: svMetadata.image ?? "",
                                      name: svMetadata.name,
                                      description: collectionName,
                                    },
                                  }
                                : isShared && shrdMetadata
                                ? {
                                    id: shrdMetadata.id,
                                    name: shrdMetadata.name,
                                    tokenId: token.tokenId,
                                    metadata: {
                                      image: shrdMetadata.image ?? "",
                                      name: shrdMetadata.name,
                                      description: collectionName,
                                    },
                                  }
                                : isTalesOfElleriaRelics && toeRelicsMetadata
                                ? {
                                    id: toeRelicsMetadata.id,
                                    name: toeRelicsMetadata.name,
                                    tokenId: token.tokenId,
                                    metadata: {
                                      image: toeRelicsMetadata.image ?? "",
                                      name: toeRelicsMetadata.name,
                                      description: collectionName,
                                    },
                                  }
                                : erc1155Metadata;

                            return (
                              <li key={token.id} className="group">
                                <div className="block w-full aspect-w-1 aspect-h-1 rounded-sm overflow-hidden sm:aspect-w-3 sm:aspect-h-3 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-gray-100 focus-within:ring-red-500">
                                  {metadata?.metadata ? (
                                    <ImageWrapper
                                      className="w-full h-full object-center object-fill group-hover:opacity-75"
                                      token={metadata}
                                    />
                                  ) : (
                                    <div className="animate-pulse w-full bg-gray-300 h-64 rounded-md m-auto" />
                                  )}
                                  <Link
                                    href={`/collection/${slugOrAddress}/${token.tokenId}`}
                                    passHref
                                  >
                                    <a className="absolute inset-0 focus:outline-none">
                                      <span className="sr-only">
                                        View details for {metadata?.name}
                                      </span>
                                    </a>
                                  </Link>
                                </div>
                                <div className="mt-4 text-base font-medium text-gray-900 space-y-2">
                                  <p className="text-xs text-gray-800 dark:text-gray-50 font-semibold truncate">
                                    {metadata?.name}
                                  </p>
                                  <p className="dark:text-gray-100 text-sm xl:text-base capsize">
                                    {formatPrice(token.stats?.floorPrice)}{" "}
                                    <span className="text-[0.5rem] xl:text-xs font-light">
                                      $MAGIC
                                    </span>
                                  </p>
                                  <p className="text-xs text-[0.6rem] ml-auto whitespace-nowrap">
                                    <span className="text-gray-500 dark:text-gray-400">
                                      Listed Items:
                                    </span>{" "}
                                    <span className="font-bold text-gray-700 dark:text-gray-300">
                                      {token.stats?.listings.toLocaleString()}
                                    </span>
                                  </p>
                                </div>
                              </li>
                            );
                          })}
                        {/* ERC721 */}
                        {group.listings?.map((listing) => {
                          const bfMetadata = battleflyMetadata.data?.find(
                            (item) => item.id === listing.token.id
                          );
                          const fsMetadata = foundersMetadata.data?.find(
                            (item) => item.id === listing.token.id
                          );
                          const swMetadata = isSmithonia
                            ? smithoniaMetadata.data?.find(
                                (item) => item.id === listing.token.tokenId
                              )
                            : null;
                          const legionsMetadata = isBridgeworldItem
                            ? bridgeworldMetadata.data?.tokens.find(
                                (item) => item.id === listing.token.id
                              )
                            : undefined;
                          const erc721Metadata =
                            legacyMetadata.data?.tokens?.find(
                              (item) => item.tokenId === listing.token.tokenId
                            );
                          const svMetadata =
                            smolverseMetadata.data?.tokens.find(
                              (item) => item.id === listing.token.id
                            );
                          const shrdMetadata = isShared
                            ? sharedMetadata.data?.tokens.find(
                                (item) => item.id === listing.token.id
                              )
                            : null;
                          const rlmMetadata = isRealm
                            ? realmMetadata.data?.realms.find(
                                (item) => item.id === listing.token.tokenId
                              )
                            : null;

                          const role =
                            legionsMetadata?.metadata?.__typename ===
                            "LegionInfo"
                              ? legionsMetadata.metadata.role
                              : null;

                          const legionStats =
                            legionsMetadata?.metadata?.__typename ===
                            "LegionInfo"
                              ? {
                                  summons: legionsMetadata.metadata.summons,
                                  summonTotal: collectionName.includes(
                                    "Genesis"
                                  )
                                    ? "Unlimited"
                                    : "1",
                                  questingXp:
                                    legionsMetadata.metadata.questingXp,
                                  questing: legionsMetadata.metadata.questing,
                                  questingTotal:
                                    legionsMetadata.metadata.questing == 1
                                      ? 100
                                      : legionsMetadata.metadata.questing == 2
                                      ? 200
                                      : legionsMetadata.metadata.questing == 3
                                      ? 500
                                      : legionsMetadata.metadata.questing == 4
                                      ? 1000
                                      : legionsMetadata.metadata.questing == 5
                                      ? 2000
                                      : null,
                                  craftingTotal:
                                    legionsMetadata.metadata.crafting == 1
                                      ? 140
                                      : legionsMetadata.metadata.crafting == 2
                                      ? 160
                                      : legionsMetadata.metadata.crafting == 3
                                      ? 160
                                      : legionsMetadata.metadata.crafting == 4
                                      ? 160
                                      : legionsMetadata.metadata.crafting == 5
                                      ? 480
                                      : legionsMetadata.metadata.crafting == 6
                                      ? 480
                                      : null,
                                  craftingXp:
                                    legionsMetadata.metadata.craftingXp,
                                  crafting: legionsMetadata.metadata.crafting,
                                }
                              : null;

                          const realmStats = rlmMetadata
                            ? {
                                features: [
                                  rlmMetadata.feature1,
                                  rlmMetadata.feature2,
                                  rlmMetadata.feature3,
                                ],
                                attributes: [
                                  ...(rlmMetadata.structures
                                    ?.filter((item) => item.staked)
                                    .map((item) => ({
                                      name: item.type
                                        .replace(/([A-Z])/g, " $1")
                                        .trim(),
                                      value: item.magicRefinery?.tier
                                        ? `Tier ${item.magicRefinery.tier}`
                                        : "Yes",
                                    })) ?? []),
                                  { name: "Magic Refinery", value: "No" },
                                  { name: "Reactor", value: "No" },
                                  {
                                    name: "Terraformed At",
                                    value:
                                      rlmMetadata.terraformedAt === "0"
                                        ? "Never"
                                        : format(
                                            new Date(
                                              Number(
                                                rlmMetadata.terraformedAt
                                              ) * 1000
                                            ),
                                            "yyyy-MM-dd"
                                          ),
                                  },
                                  ...Object.entries(
                                    rlmMetadata.totalNaturalResources?.[0] ?? []
                                  ).map(([name, value]) => ({
                                    name: name[0]
                                      .toUpperCase()
                                      .concat(
                                        name.slice(1).replace(/([A-Z])/g, " $1")
                                      ),
                                    value,
                                  })),
                                ]
                                  .filter(
                                    (attribute, index, array) =>
                                      array.findIndex(
                                        (item) => item.name === attribute.name
                                      ) === index
                                  )
                                  .map((attribute) => ({ attribute })),
                              }
                            : null;
                          const elleriaStats =
                            collectionName === "Tales of Elleria" &&
                            shrdMetadata
                              ? {
                                  attributes: [
                                    shrdMetadata.attributes.find(
                                      (item) => item.name === "Class"
                                    ),
                                    shrdMetadata.attributes.find(
                                      (item) => item.name === "Rarity"
                                    ),
                                    shrdMetadata.attributes.find(
                                      (item) => item.name === "Level"
                                    ),
                                    ...[
                                      "Agility",
                                      "Endurance",
                                      "Intelligence",
                                      "Strength",
                                      "Vitality",
                                      "Will",
                                      "Total Stats",
                                    ].map((name) => ({
                                      name,
                                      value: `${
                                        shrdMetadata.attributes.find(
                                          (item) => item.name === name
                                        )?.value
                                      }/${
                                        shrdMetadata.attributes.find(
                                          (item) => item.name === `Max ${name}`
                                        )?.value
                                      }`,
                                    })),
                                  ].map((attribute) => ({ attribute })),
                                }
                              : null;

                          const metadata = isBridgeworldItem
                            ? legionsMetadata
                              ? {
                                  id: legionsMetadata.id,
                                  name: legionsMetadata.name,
                                  tokenId: listing.token.tokenId,
                                  metadata: {
                                    image: legionsMetadata.image,
                                    name: legionsMetadata.name,
                                    description: "Legions",
                                  },
                                }
                              : erc721Metadata
                            : bfMetadata
                            ? {
                                id: bfMetadata.id,
                                name: bfMetadata.name,
                                tokenId: listing.token.tokenId,
                                metadata: {
                                  image: bfMetadata.image ?? "",
                                  name: bfMetadata.name,
                                  description: collectionName,
                                },
                              }
                            : fsMetadata
                            ? {
                                id: fsMetadata.id,
                                name: fsMetadata.name,
                                tokenId: listing.token.tokenId,
                                metadata: {
                                  image: fsMetadata.image ?? "",
                                  name: fsMetadata.name,
                                  description: collectionName,
                                },
                              }
                            : svMetadata
                            ? {
                                id: svMetadata.id,
                                name: svMetadata.name,
                                tokenId: listing.token.tokenId,
                                metadata: {
                                  image: svMetadata.image ?? "",
                                  name: svMetadata.name,
                                  description: collectionName,
                                },
                              }
                            : swMetadata
                            ? {
                                id: swMetadata.id,
                                name: swMetadata.name,
                                tokenId: listing.token.tokenId,
                                metadata: {
                                  image: swMetadata.image ?? "",
                                  name: swMetadata.name,
                                  description: collectionName,
                                },
                              }
                            : shrdMetadata
                            ? {
                                id: shrdMetadata.id,
                                name: shrdMetadata.name,
                                tokenId: listing.token.tokenId,
                                metadata: {
                                  image: shrdMetadata.image ?? "",
                                  name: shrdMetadata.name,
                                  description: collectionName,
                                },
                              }
                            : rlmMetadata
                            ? {
                                id: rlmMetadata.id,
                                name: `${collectionName} #${listing.token.tokenId}`,
                                tokenId: listing.token.tokenId,
                                metadata: {
                                  image: "/img/realm.jpg",
                                  name: `${collectionName} #${listing.token.tokenId}`,
                                  description: collectionName,
                                },
                              }
                            : erc721Metadata;

                          const normalizedLegion =
                            normalizeBridgeworldTokenMetadata(legionsMetadata);

                          const moreInfo =
                            normalizedLegion ?? realmStats ?? elleriaStats;

                          return (
                            <li key={listing.id} className="group">
                              <div className="block w-full aspect-w-1 aspect-h-1 rounded-sm overflow-hidden focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-gray-100 focus-within:ring-red-500">
                                {metadata ? (
                                  <>
                                    <ImageWrapper
                                      className="w-full h-full object-center object-fill group-hover:opacity-75"
                                      token={metadata}
                                    />
                                    <div
                                      className="flex flex-col justify-end space-y-2 opacity-0 p-4 group-hover:opacity-100 group-focus-within:opacity-100 z-10"
                                      aria-hidden="true"
                                    >
                                      <Link
                                        href={`/collection/${slugOrAddress}/${listing.token.tokenId}`}
                                        passHref
                                      >
                                        <a className="w-full bg-white bg-opacity-75 backdrop-filter backdrop-blur py-2 px-4 rounded-md text-sm font-medium text-gray-900 text-center">
                                          View Details
                                        </a>
                                      </Link>
                                      {account ? (
                                        <button
                                          onClick={() => {
                                            setModalProps({
                                              isOpen: true,
                                              targetNft: {
                                                metadata: {
                                                  name: metadata.name ?? "",
                                                  description:
                                                    metadata.metadata
                                                      ?.description ?? "",
                                                  image:
                                                    metadata.metadata?.image ??
                                                    "",
                                                },
                                                payload: {
                                                  ...listing,
                                                  standard:
                                                    TokenStandard.ERC721,
                                                  tokenId: metadata.tokenId,
                                                },
                                                slug,
                                                collection: collectionName,
                                              },
                                            });
                                          }}
                                          className="w-full bg-red-500 bg-opacity-75 backdrop-filter backdrop-blur py-2 px-4 rounded-md text-sm font-medium text-white text-center"
                                        >
                                          Quick Buy
                                        </button>
                                      ) : null}
                                    </div>
                                  </>
                                ) : (
                                  <div className="animate-pulse w-full bg-gray-300 h-64 rounded-md m-auto" />
                                )}
                              </div>
                              <div className="mt-4 font-medium text-gray-900 space-y-2">
                                <div className="flex justify-between items-center">
                                  <p className="text-xs text-gray-500 dark:text-gray-300 truncate font-semibold">
                                    {metadata?.name}
                                    {role ? ` - ${role}` : ""}
                                  </p>
                                  {moreInfo ? (
                                    <div className="flex">
                                      <Popover.Root>
                                        <Popover.Trigger asChild>
                                          <button>
                                            <InformationCircleIcon className="h-4 w-4 fill-gray-500" />
                                          </button>
                                        </Popover.Trigger>
                                        <Popover.Anchor />
                                        <Popover.Content className="rounded-md w-60 border border-gray-100 dark:border-gray-600 bg-white dark:bg-gray-600 shadow-md text-gray-200 px-2 py-3">
                                          <div className="space-y-2 flex items-center justify-center flex-col">
                                            {hasAttributeArray(
                                              moreInfo.attributes
                                            )
                                              ? moreInfo.attributes.map(
                                                  ({ attribute }) => (
                                                    <div
                                                      key={attribute.name}
                                                      className="flex items-center justify-between w-full"
                                                    >
                                                      <p className="text-xs text-gray-600 font-bold dark:text-gray-400 truncate">
                                                        {attribute.name}
                                                      </p>
                                                      <p className="text-xs text-gray-500 dark:text-gray-300 truncate">
                                                        {attribute.value}
                                                      </p>
                                                    </div>
                                                  )
                                                )
                                              : null}
                                          </div>
                                          <Popover.Arrow className="text-gray-100 dark:text-gray-600 fill-current" />
                                        </Popover.Content>
                                      </Popover.Root>
                                    </div>
                                  ) : null}
                                </div>
                                <p className="dark:text-gray-100 text-sm xl:text-base capsize">
                                  {formatNumber(
                                    parseFloat(
                                      formatEther(listing.pricePerItem)
                                    )
                                  )}{" "}
                                  <span className="text-[0.5rem] xl:text-xs font-light">
                                    $MAGIC
                                  </span>
                                </p>
                                {realmStats?.features ? (
                                  <p className="xl:text-[0.6rem] text-[0.5rem] ml-auto whitespace-nowrap">
                                    <span className="text-gray-500 dark:text-gray-400">
                                      Feature 1:
                                    </span>{" "}
                                    <span className="font-bold text-gray-700 dark:text-gray-300">
                                      {realmStats.features[0]}
                                    </span>
                                    <br />
                                    <span className="text-gray-500 dark:text-gray-400">
                                      Feature 2:
                                    </span>{" "}
                                    <span className="font-bold text-gray-700 dark:text-gray-300">
                                      {realmStats.features[1]}
                                    </span>
                                    <br />
                                    <span className="text-gray-500 dark:text-gray-400">
                                      Feature 3:
                                    </span>{" "}
                                    <span className="font-bold text-gray-700 dark:text-gray-300">
                                      {realmStats.features[2]}
                                    </span>
                                  </p>
                                ) : null}
                                {elleriaStats?.attributes ? (
                                  <p className="xl:text-[0.6rem] text-[0.5rem] ml-auto whitespace-nowrap">
                                    <span className="text-gray-500 dark:text-gray-400">
                                      Class:
                                    </span>{" "}
                                    <span className="font-bold text-gray-700 dark:text-gray-300">
                                      {
                                        elleriaStats.attributes[0]?.attribute
                                          ?.value
                                      }
                                    </span>
                                    <br />
                                    <span className="text-gray-500 dark:text-gray-400">
                                      Rarity:
                                    </span>{" "}
                                    <span className="font-bold text-gray-700 dark:text-gray-300">
                                      {
                                        elleriaStats.attributes[1]?.attribute
                                          ?.value
                                      }
                                    </span>
                                    <br />
                                    <span className="text-gray-500 dark:text-gray-400">
                                      Level:
                                    </span>{" "}
                                    <span className="font-bold text-gray-700 dark:text-gray-300">
                                      {
                                        elleriaStats.attributes[2]?.attribute
                                          ?.value
                                      }
                                    </span>
                                  </p>
                                ) : null}
                                {legionStats?.summons ? (
                                  <p className="xl:text-[0.6rem] text-[0.5rem] ml-auto whitespace-nowrap">
                                    <span className="text-gray-500 dark:text-gray-400">
                                      Summoned:
                                    </span>{" "}
                                    <span className="font-bold text-gray-700 dark:text-gray-300">
                                      {legionStats.summons} /{" "}
                                      {legionStats.summonTotal}
                                    </span>
                                    <br />
                                    <span className="text-gray-500 dark:text-gray-400">
                                      Questing:
                                    </span>{" "}
                                    <span className="font-bold text-gray-700 dark:text-gray-300">
                                      Lv. {legionStats.questing} (
                                      {legionStats.questingXp}/
                                      {legionStats.questingTotal} XP)
                                    </span>
                                    <br />
                                    <span className="text-gray-500 dark:text-gray-400">
                                      Crafting:
                                    </span>{" "}
                                    <span className="font-bold text-gray-700 dark:text-gray-300">
                                      Lv. {legionStats.crafting} (
                                      {legionStats.craftingXp}/
                                      {legionStats.craftingTotal} XP)
                                    </span>
                                  </p>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </ul>
                  {listings.hasNextPage && (
                    <ul
                      role="list"
                      ref={ref}
                      className="mt-10 grid grid-cols-2 gap-y-10 sm:grid-cols-4 gap-x-6 lg:grid-cols-6 xl:gap-x-8"
                    >
                      {Array.from({ length: 6 }).map((_, i) => (
                        <li key={i}>
                          <div className="animate-pulse w-full bg-gray-300 h-64 rounded-md m-auto" />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
            </div>
          </div>
        ) : (
          <Activity title="Activity" />
        )}
      </div>

      {statData?.collection && isDetailedFloorPriceModalOpen && (
        <DetailedFloorPriceModal
          isOpen={true}
          onClose={() => setDetailedFloorPriceModalOpen(false)}
          tokens={tokensWithStats}
        />
      )}
      {modalProps.isOpen && modalProps.targetNft && (
        <PurchaseItemModal
          address={formattedAddress}
          isOpen={true}
          onClose={closePurchaseModal}
          targetNft={modalProps.targetNft}
        />
      )}
    </div>
  );
};

const DetailedFloorPriceModal = ({
  isOpen,
  onClose,
  tokens = [],
}: {
  isOpen: boolean;
  onClose: () => void;
  tokens: GetCollectionListingsQuery["tokens"];
}) => {
  const [lists, setList] = useState(tokens);

  return (
    <Modal onClose={onClose} isOpen={isOpen} title="Compare floor prices">
      <div className="mt-4">
        <SearchAutocomplete
          placeholder="Search Token..."
          onSelectionChange={(key) => {
            if (!key) {
              setList(tokens);
              return;
            }

            setList(tokens.filter((token) => token.name === key));
          }}
        >
          {lists.map((list) => (
            <Item key={list.name}>{list.name}</Item>
          ))}
        </SearchAutocomplete>
        <div className="flex flex-col mt-2">
          <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
              <div className="overflow-auto dark:divide-gray-400 rounded-md max-h-96">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 dark:bg-gray-500 sticky top-0">
                    <tr>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                      >
                        Token
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider"
                      >
                        Floor Price ($MAGIC)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lists
                      .sort(
                        (left, right) =>
                          left.name?.localeCompare(right.name ?? "") ?? 0
                      )
                      .map((list, listIdx) => {
                        return (
                          <tr
                            key={list.name}
                            className={
                              listIdx % 2 === 0
                                ? "bg-white dark:bg-gray-200"
                                : "bg-gray-50 dark:bg-gray-300"
                            }
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-700">
                              {list.name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-700">
                              {formatPrice(list.stats?.floorPrice)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export async function getServerSideProps(context: GetServerSidePropsContext) {
  if (!context.params) {
    throw new Error("No params");
  }

  const { address } = context.params;

  if (typeof address !== "string") {
    throw new Error("`address` is not a string");
  }

  const title = getCollectionNameFromSlug(address);
  const metadata = ALL_COLLECTION_METADATA.find(
    (collection) => collection.href === address
  );

  if (!metadata) {
    throw new Error("No metadata");
  }

  const { description, image } = metadata;

  return {
    props: {
      og: {
        description,
        image,
        title,
        url: `https://marketplace.treasure.lol${context.resolvedUrl}`,
      },
    },
  };
}

export default Collection;
