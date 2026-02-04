import { motion } from "framer-motion";
import { CollectionBadge } from "./collection-badge";
import type { UserCollection } from "@shared/schema";

interface CollectionListProps {
  collections: UserCollection[];
  onCollectionClick?: (collection: UserCollection) => void;
}

export function CollectionList({ collections, onCollectionClick }: CollectionListProps) {
  // Sort: completed first, then by progress percentage
  const sortedCollections = [...collections].sort((a, b) => {
    if (a.completed && !b.completed) return -1;
    if (!a.completed && b.completed) return 1;
    const aProgress = a.progress / a.total;
    const bProgress = b.progress / b.total;
    return bProgress - aProgress;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Collections</h3>
        <span className="text-sm text-muted-foreground">
          {collections.filter((c) => c.completed).length} of {collections.length} completed
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
      >
        {sortedCollections.map((collection, index) => (
          <motion.div
            key={`${collection.collectionType}-${collection.targetId}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 25,
              delay: index * 0.05,
            }}
          >
            <CollectionBadge
              collection={collection}
              size="md"
              onClick={() => onCollectionClick?.(collection)}
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
