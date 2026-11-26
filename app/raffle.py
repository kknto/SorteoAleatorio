import secrets
from typing import TypeVar

T = TypeVar("T")


def generate_derangement(items: list[T]) -> dict[T, T]:
    """Generate a random single-cycle derangement using Sattolo's algorithm.

    Guarantees:
    - Works for any N >= 2 (even or odd).
    - Every item maps to exactly one distinct item (bijection).
    - No item maps to itself (no fixed points).
    - Uses cryptographically secure randomness via `secrets.randbelow`.
    """
    n = len(items)
    if n < 2:
        raise ValueError("Se necesitan al menos 2 participantes para realizar el sorteo.")

    shuffled = list(items)
    for i in range(n - 1, 0, -1):
        j = secrets.randbelow(i)  # 0 <= j < i (strictly less than i)
        shuffled[i], shuffled[j] = shuffled[j], shuffled[i]

    return {items[idx]: shuffled[idx] for idx in range(n)}


def verify_assignments(pairs: list[tuple[int, int]], participant_ids: list[int]) -> bool:
    """Verify that every participant gives to and receives from exactly one other person."""
    expected = set(participant_ids)
    if len(pairs) != len(expected):
        return False

    givers = set()
    receivers = set()
    for giver, receiver in pairs:
        if giver == receiver:
            return False
        givers.add(giver)
        receivers.add(receiver)

    return givers == expected and receivers == expected
