<script setup lang="ts">
import { useSlideContext } from "@slidev/client";

defineOptions({ render: () => null });

const props = defineProps({
	size: { default: 1, type: [String, Number] },
});

const { $clicksContext: clicks } = useSlideContext();
const delta = Number(props.size);
clicks.register(Symbol("click-gap"), {
	delta,
	max: clicks.currentOffset + delta - 1,
});
</script>
