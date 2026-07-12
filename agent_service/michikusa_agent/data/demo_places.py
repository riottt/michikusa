from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DemoPlaceTemplate:
    slug: str
    name: str
    category: str
    lat_offset: float
    lng_offset: float
    address: str
    estimated_cost_yen: int
    rating: float


DEMO_PLACE_TEMPLATES = [
    DemoPlaceTemplate("book-nook", "小さな選書室", "book_store", 0.0062, -0.0031, "駅から少し離れた通り", 0, 4.5),
    DemoPlaceTemplate("river-bench", "川沿いのベンチ", "river", -0.0048, 0.0065, "水辺の遊歩道", 0, 4.3),
    DemoPlaceTemplate("alley-cafe", "路地裏の喫茶店", "cafe", 0.0038, 0.0052, "細い路地の奥", 700, 4.6),
    DemoPlaceTemplate("green-pocket", "緑の小径", "park", -0.0064, -0.0042, "小さな都市公園", 0, 4.2),
    DemoPlaceTemplate("free-gallery", "白い壁のギャラリー", "art_gallery", 0.0081, 0.0034, "古いビルの二階", 0, 4.4),
    DemoPlaceTemplate("old-market", "古い商店街の入口", "shopping", -0.0022, -0.0076, "昔ながらのアーケード", 500, 4.1),
    DemoPlaceTemplate("quiet-library", "まちの図書室", "library", 0.0092, -0.0061, "公共文化施設", 0, 4.7),
    DemoPlaceTemplate("lookout", "風の抜ける歩道橋", "viewpoint", -0.0084, 0.0019, "街を見渡せる場所", 0, 4.0),
    DemoPlaceTemplate("record-coffee", "レコードのあるコーヒースタンド", "cafe", 0.0011, 0.0093, "路面の小さな店", 800, 4.8),
    DemoPlaceTemplate("shrine", "街角の小さな社", "shrine", 0.0054, -0.0088, "静かな境内", 0, 4.3),
    DemoPlaceTemplate("photo-street", "色のある路地", "street", -0.0091, -0.0023, "古い建物が残る一角", 0, 4.2),
    DemoPlaceTemplate("bakery", "夕方のベーカリー", "bakery", 0.0074, 0.0078, "住宅街の角", 600, 4.6),
    DemoPlaceTemplate("garden", "屋上の小庭", "garden", -0.0014, 0.0112, "商業施設の屋上", 0, 4.1),
    DemoPlaceTemplate("museum-corner", "小さな資料展示室", "museum", 0.0111, 0.0007, "地域の文化施設", 300, 4.4),
    DemoPlaceTemplate("tea-window", "窓辺のティールーム", "cafe", -0.0055, 0.0091, "静かな二階席", 900, 4.5),
    DemoPlaceTemplate("station-back", "知らない駅の裏口", "station", 0.0104, -0.0101, "普段使わない出口", 0, 4.0),
]
