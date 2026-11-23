try {
  const saved = localStorage.getItem("overture.theme");
  const dark =
    saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);

  if (dark) {
    document.documentElement.classList.add("dark");
  }
} catch (error) {
  void error;
}
