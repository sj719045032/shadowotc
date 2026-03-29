import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import App from "./App";
import CreateOrder from "./pages/CreateOrder";
import OrderBook from "./pages/OrderBook";
import MyTrades from "./pages/MyTrades";
import OrderDetail from "./pages/OrderDetail";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<OrderBook />} />
          <Route path="create" element={<CreateOrder />} />
          <Route path="trades" element={<MyTrades />} />
          <Route path="order/:id" element={<OrderDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
