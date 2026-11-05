
import api from "./api";

export const loginUser = async (credentials) => {
  const response = await api.post("/users/login", credentials);

  const { token, user } = response.data.data;

  localStorage.setItem("accessToken", token);
  localStorage.setItem("user", JSON.stringify(user));

  return user;
};

export const registerUser = async (userData) => {
  const response = await api.post("/users/register", userData);

  return response.data;
};

export const getMyProfile = async () => {
  const response = await api.get("/users/me");

  return response.data.data.user;
};

export const logoutUser = () => {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("user");
};
