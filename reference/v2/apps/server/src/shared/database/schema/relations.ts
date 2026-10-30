import { relations } from "drizzle-orm/relations";
import { customers, linkRequests, orders, campaigns, campaignAwards } from "./schema";

export const linkRequestsRelations = relations(linkRequests, ({one, many}) => ({
	customer: one(customers, {
		fields: [linkRequests.customerId],
		references: [customers.customerId]
	}),
	orders: many(orders),
}));

export const customersRelations = relations(customers, ({many}) => ({
	linkRequests: many(linkRequests),
	orders: many(orders),
}));

export const ordersRelations = relations(orders, ({one}) => ({
	linkRequest: one(linkRequests, {
		fields: [orders.requestId],
		references: [linkRequests.requestId]
	}),
	customer: one(customers, {
		fields: [orders.customerId],
		references: [customers.customerId]
	}),
}));

export const campaignAwardsRelations = relations(campaignAwards, ({one}) => ({
	campaign: one(campaigns, {
		fields: [campaignAwards.campaignId],
		references: [campaigns.campaignId]
	}),
}));

export const campaignsRelations = relations(campaigns, ({many}) => ({
	campaignAwards: many(campaignAwards),
}));