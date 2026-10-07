-- Move ads from the old 20 categories to the closest one in the new
-- grouped taxonomy (adplaylist-fe/src/lib/categories.ts, CATEGORY_ALIASES).
-- Pets, Travel, Automotive, Luxury Fashion and Mental Wellness keep their name.
UPDATE `ads` SET `category` = CASE `category`
    WHEN 'E-commerce / DTC' THEN 'Other'
    WHEN 'Fashion & Apparel' THEN 'Fashion'
    WHEN 'Jewelry & Accessories' THEN 'Jewelry'
    WHEN 'Beauty & Skincare' THEN 'Skincare'
    WHEN 'Personal care / Grooming' THEN 'Men''s Grooming'
    WHEN 'Health & Fitness' THEN 'Health'
    WHEN 'Food & Beverage' THEN 'Food'
    WHEN 'Home & Living' THEN 'Home Decor'
    WHEN 'Parenting & Baby' THEN 'Parenting'
    WHEN 'Sustainability & Eco' THEN 'Sustainability'
    WHEN 'SaaS & Tech' THEN 'SaaS'
    WHEN 'Apps & Subscriptions' THEN 'Mobile Apps'
    WHEN 'Gaming & Creator' THEN 'Gaming'
    WHEN 'Finance & Fintech' THEN 'Fintech'
    WHEN 'Education & E-learning' THEN 'E-learning'
    ELSE `category`
END
WHERE `category` IN (
    'E-commerce / DTC', 'Fashion & Apparel', 'Jewelry & Accessories',
    'Beauty & Skincare', 'Personal care / Grooming', 'Health & Fitness',
    'Food & Beverage', 'Home & Living', 'Parenting & Baby',
    'Sustainability & Eco', 'SaaS & Tech', 'Apps & Subscriptions',
    'Gaming & Creator', 'Finance & Fintech', 'Education & E-learning'
);
