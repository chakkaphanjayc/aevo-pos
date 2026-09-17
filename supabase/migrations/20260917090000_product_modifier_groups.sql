-- Phase 3: Product ↔ Modifier Group junction table.
-- Tells the POS which modifier groups to show when a product is selected.

CREATE TABLE IF NOT EXISTS public.product_modifier_groups (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  modifier_group_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (organization_id, product_id, modifier_group_id),
  UNIQUE (organization_id, product_id, modifier_group_id),
  FOREIGN KEY (organization_id, product_id)
    REFERENCES public.products(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, modifier_group_id)
    REFERENCES public.modifier_groups(organization_id, id) ON DELETE CASCADE
);

ALTER TABLE public.product_modifier_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_member_read_product_modifier_groups"
  ON public.product_modifier_groups FOR SELECT
  USING (private.is_org_member(organization_id));

CREATE POLICY "org_catalog_manage_product_modifier_groups"
  ON public.product_modifier_groups FOR ALL
  USING (private.has_org_permission(organization_id, 'catalog.manage'));

CREATE INDEX IF NOT EXISTS idx_product_modifier_groups_product
  ON public.product_modifier_groups (organization_id, product_id);

CREATE INDEX IF NOT EXISTS idx_product_modifier_groups_group
  ON public.product_modifier_groups (organization_id, modifier_group_id);
