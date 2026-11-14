import { defineAppSetup } from "@slidev/types";
import { h } from "vue";

export default defineAppSetup(async ({ app, router }) => {
	let navigated = "nowhere";
	router.afterEach((to) => {
		navigated = to.path;
	});
	await router.isReady();
	app.component("RegisteredInSetup", {
		render: () =>
			h(
				"p",
				`Registered in setup at ${router.currentRoute.value.path} after navigating to ${navigated}`,
			),
	});
});
