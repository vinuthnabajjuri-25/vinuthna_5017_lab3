
const express = require("express");
const sqlite3 = require("sqlite3");
const sqlite = require("sqlite");
const path = require("path");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const dbPath = path.join(__dirname, "database.db");

let db;

// Validate book ID
const getValidBookId = (value) => {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }

  return id;
};

// Validate book details
const validateBook = (body) => {
  const { title, author, price, pages } = body;

  if (typeof title !== "string" || title.trim() === "") {
    return "Title is required.";
  }

  if (typeof author !== "string" || author.trim() === "") {
    return "Author is required.";
  }

  if (price === undefined || price === null || price === "" ||
      !Number.isFinite(Number(price))) {
    return "Price must be a valid number.";
  }

  if (Number(price) < 0) {
    return "Price cannot be negative.";
  }

  if (!Number.isInteger(Number(price))) {
    return "Price must be an integer.";
  }

  if (!Number.isInteger(Number(pages)) || Number(pages) <= 0) {
    return "Pages must be a positive integer.";
  }

  return null;
};

// Initialize database and start server
const initializeDBAndServer = async () => {
  try {
    db = await sqlite.open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    await db.run(`
      CREATE TABLE IF NOT EXISTS book (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        price INTEGER NOT NULL,
        pages INTEGER NOT NULL
      )
    `);

    console.log("Database connected successfully.");

    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Database initialization failed:", error.message);
    process.exit(1);
  }
};

// GET /books - Search, sort, filter and paginate books
app.get("/books", async (req, res) => {
  try {
    const {
      search_q = "",
      order_by = "id",
      order = "ASC",
      limit = "10",
      offset = "0",
      min_price,
      max_price,
    } = req.query;

    // Allow only approved sorting columns
    const allowedColumns = ["id", "title", "author", "price", "pages"];

    if (!allowedColumns.includes(order_by)) {
      return res.status(400).json({
        message: "Invalid order_by column.",
      });
    }

    const sortOrder = String(order).toUpperCase();

    if (!["ASC", "DESC"].includes(sortOrder)) {
      return res.status(400).json({
        message: "Order must be ASC or DESC.",
      });
    }

    const pageLimit = Number(limit);
    const pageOffset = Number(offset);

    if (
      !Number.isInteger(pageLimit) ||
      pageLimit <= 0 ||
      !Number.isInteger(pageOffset) ||
      pageOffset < 0
    ) {
      return res.status(400).json({
        message: "Limit must be positive and offset must be non-negative.",
      });
    }

    const conditions = [];
    const values = [];

    // Search books by partial title
    if (search_q.trim() !== "") {
      conditions.push("title LIKE ?");
      values.push(`%${search_q.trim()}%`);
    }

    // Minimum price filter
    if (min_price !== undefined) {
      const min = Number(min_price);

      if (!Number.isFinite(min) || min < 0) {
        return res.status(400).json({
          message: "min_price must be a non-negative number.",
        });
      }

      conditions.push("price >= ?");
      values.push(min);
    }

    // Maximum price filter
    if (max_price !== undefined) {
      const max = Number(max_price);

      if (!Number.isFinite(max) || max < 0) {
        return res.status(400).json({
          message: "max_price must be a non-negative number.",
        });
      }

      conditions.push("price <= ?");
      values.push(max);
    }

    if (
      min_price !== undefined &&
      max_price !== undefined &&
      Number(min_price) > Number(max_price)
    ) {
      return res.status(400).json({
        message: "min_price cannot be greater than max_price.",
      });
    }

    let sql = "SELECT * FROM book";

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    // Sorting uses allowlisted column names and order values
    sql += ` ORDER BY ${order_by} ${sortOrder}`;

    // Pagination
    sql += " LIMIT ? OFFSET ?";
    values.push(pageLimit, pageOffset);

    const books = await db.all(sql, values);

    res.status(200).json(books);
  } catch (error) {
    res.status(500).json({
      message: "Unable to retrieve books.",
    });
  }
});

// GET /books/:bookId - Get one book
app.get("/books/:bookId", async (req, res) => {
  try {
    const bookId = getValidBookId(req.params.bookId);

    if (!bookId) {
      return res.status(400).json({
        message: "Invalid book ID.",
      });
    }

    const book = await db.get(
      "SELECT * FROM book WHERE id = ?",
      [bookId]
    );

    if (!book) {
      return res.status(404).json({
        message: "Book not found.",
      });
    }

    res.status(200).json(book);
  } catch (error) {
    res.status(500).json({
      message: "Unable to retrieve book.",
    });
  }
});

// POST /books - Add a new book
app.post("/books", async (req, res) => {
  try {
    const validationError = validateBook(req.body);

    if (validationError) {
      return res.status(400).json({
        message: validationError,
      });
    }

    const { title, author, price, pages } = req.body;

    const result = await db.run(
      `INSERT INTO book (title, author, price, pages)
       VALUES (?, ?, ?, ?)`,
      [
        title.trim(),
        author.trim(),
        Number(price),
        Number(pages),
      ]
    );

    const newBook = await db.get(
      "SELECT * FROM book WHERE id = ?",
      [result.lastID]
    );

    res.status(201).json(newBook);
  } catch (error) {
    res.status(500).json({
      message: "Unable to add book.",
    });
  }
});

// PUT /books/:bookId - Update a book
app.put("/books/:bookId", async (req, res) => {
  try {
    const bookId = getValidBookId(req.params.bookId);

    if (!bookId) {
      return res.status(400).json({
        message: "Invalid book ID.",
      });
    }

    const validationError = validateBook(req.body);

    if (validationError) {
      return res.status(400).json({
        message: validationError,
      });
    }

    const existingBook = await db.get(
      "SELECT * FROM book WHERE id = ?",
      [bookId]
    );

    if (!existingBook) {
      return res.status(404).json({
        message: "Book not found.",
      });
    }

    const { title, author, price, pages } = req.body;

    await db.run(
      `UPDATE book
       SET title = ?, author = ?, price = ?, pages = ?
       WHERE id = ?`,
      [
        title.trim(),
        author.trim(),
        Number(price),
        Number(pages),
        bookId,
      ]
    );

    const updatedBook = await db.get(
      "SELECT * FROM book WHERE id = ?",
      [bookId]
    );

    res.status(200).json(updatedBook);
  } catch (error) {
    res.status(500).json({
      message: "Unable to update book.",
    });
  }
});

// DELETE /books/:bookId - Delete a book
app.delete("/books/:bookId", async (req, res) => {
  try {
    const bookId = getValidBookId(req.params.bookId);

    if (!bookId) {
      return res.status(400).json({
        message: "Invalid book ID.",
      });
    }

    const result = await db.run(
      "DELETE FROM book WHERE id = ?",
      [bookId]
    );

    if (result.changes === 0) {
      return res.status(404).json({
        message: "Book not found.",
      });
    }

    res.status(200).json({
      message: "Book deleted successfully.",
    });
  } catch (error) {
    res.status(500).json({
      message: "Unable to delete book.",
    });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found.",
  });
});

initializeDBAndServer();
