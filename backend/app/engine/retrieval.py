"""Dependency-free Korean character-bigram TF-IDF document search."""

import math
import re
from collections import Counter


def bigrams(text: str) -> Counter[str]:
    normalized = re.sub(r"\s+", " ", text.casefold())
    return Counter(normalized[index : index + 2] for index in range(len(normalized) - 1))


def search_documents(
    question: str, documents: dict[str, str], candidates: list[str] | None = None
) -> list[str]:
    """Return matching IDs in similarity order; ties are stable by document ID.

    The answer layer must resolve ambiguous listing identities before selecting
    a document. Similar wording alone is not evidence that a listing was intended.
    """
    vectors = {doc_id: bigrams(document) for doc_id, document in documents.items()}
    frequency = Counter(gram for vector in vectors.values() for gram in vector)
    weights = {
        gram: math.log((1 + len(documents)) / (1 + count)) + 1 for gram, count in frequency.items()
    }
    query = bigrams(question)

    def length(vector: Counter[str]) -> float:
        return math.sqrt(sum((count * weights.get(gram, 1)) ** 2 for gram, count in vector.items()))

    query_length = length(query)

    def similarity(doc_id: str) -> float:
        vector = vectors[doc_id]
        denominator = query_length * length(vector)
        dot = sum(
            query[gram] * vector[gram] * weights.get(gram, 1) ** 2
            for gram in query.keys() & vector.keys()
        )
        return dot / denominator if denominator else 0.0

    selected = list(documents) if candidates is None else candidates
    return sorted(selected, key=lambda doc_id: (-similarity(doc_id), doc_id))
