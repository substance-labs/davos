FROM python:3.12-slim

WORKDIR /app

# Install pipenv
RUN pip install pipenv

# Copy Pipfile and install dependencies
COPY Pipfile* ./
RUN pipenv install --ignore-pipfile

# Copy application code
COPY . .

# Expose API port
EXPOSE 6000

# Run the API server
CMD ["pipenv", "run", "python", "api_server.py"]