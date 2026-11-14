import { defineAppSetup } from "@slidev/types";
import { h } from "vue";

export default defineAppSetup(async ({ app, router }) => {
	router.afterEach(() => undefined);
	await router.isReady();
	app.component("RegisteredInSetup", {
		render: () =>
			h("p", `Registered in setup at ${router.currentRoute.value.path}`),
	});
});
