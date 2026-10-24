import math

# Let's verify the exact filled outline geometry of Concept A1:
# Top-Left Bracket:
# Outer edge:
# Start at (18, 168)
# Vertical line up to (18, 84)
# Arc radius 66 from (18, 84) to (84, 18): A 66 66 0 0 1 84 18
# Horizontal line right to (168, 18)
# Right semicircular cap: radius 22 from (168, 18) to (168, 62): A 22 22 0 0 1 168 62
# Horizontal line left to (84, 62)
# Inner arc radius 22 from (84, 62) to (62, 84): A 22 22 0 0 0 62 84
# Vertical line down to (62, 168)
# Bottom semicircular cap: radius 22 from (62, 168) to (18, 168): A 22 22 0 0 1 18 168 Z

# Bottom-Right Bracket (180 deg rotation):
# Rotated: (x', y') = (256 - x, 256 - y)
# (18, 168) -> (238, 88)
# (18, 84)  -> (238, 172)
# (84, 18)  -> (172, 238)
# (168, 18) -> (88, 238)
# (168, 62) -> (88, 194)
# (84, 62)  -> (172, 194)
# (62, 84)  -> (194, 172)
# (62, 168) -> (194, 88)

# Let's verify paths:
path_top_left = (
    "M 18 168 "
    "V 84 "
    "A 66 66 0 0 1 84 18 "
    "H 168 "
    "A 22 22 0 0 1 168 62 "
    "H 84 "
    "A 22 22 0 0 0 62 84 "
    "V 168 "
    "A 22 22 0 0 1 18 168 Z"
)

path_bottom_right = (
    "M 238 88 "
    "V 172 "
    "A 66 66 0 0 1 172 238 "
    "H 88 "
    "A 22 22 0 0 1 88 194 "
    "H 172 "
    "A 22 22 0 0 0 194 172 "
    "V 88 "
    "A 22 22 0 0 1 238 88 Z"
)

print("Constructed filled paths successfully.")
