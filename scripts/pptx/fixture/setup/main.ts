import { defineAppSetup } from "@slidev/types";
import { h } from "vue";

export default defineAppSetup(({ app, router }) => {
	router.afterEach(() => undefined);
	app.component("RegisteredInSetup", {
		render: () => h("p", "Registered in setup"),
	});
});
